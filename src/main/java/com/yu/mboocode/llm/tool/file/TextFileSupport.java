package com.yu.mboocode.llm.tool.file;

import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.Charset;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.nio.file.AccessDeniedException;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.FileAlreadyExistsException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.AclEntry;
import java.nio.file.attribute.AclFileAttributeView;
import java.nio.file.attribute.BasicFileAttributes;
import java.nio.file.attribute.DosFileAttributeView;
import java.nio.file.attribute.DosFileAttributes;
import java.nio.file.attribute.FileOwnerAttributeView;
import java.nio.file.attribute.PosixFileAttributeView;
import java.nio.file.attribute.PosixFilePermission;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Arrays;
import java.util.List;
import java.util.Set;

@Component
public class TextFileSupport {
    private static final int BINARY_PROBE_BYTES = 8000;
    private static final byte[] UTF8_BOM = {(byte) 0xEF, (byte) 0xBB, (byte) 0xBF};
    private static final byte[] UTF16_LE_BOM = {(byte) 0xFF, (byte) 0xFE};
    private static final byte[] UTF16_BE_BOM = {(byte) 0xFE, (byte) 0xFF};

    public TextDocument read(Path path) {
        try {
            long size = Files.size(path);
            if (size > FileToolSupport.MAX_FILE_BYTES) {
                throw new FileToolException(FileToolErrorCode.FILE_TOO_LARGE, "文件大小不能超过 10 MiB");
            }
            byte[] bytes = Files.readAllBytes(path);
            EncodingInfo encoding = detectEncoding(bytes);
            byte[] body = Arrays.copyOfRange(bytes, encoding.bomLength(), bytes.length);
            if (encoding.charset() == StandardCharsets.UTF_8 && containsNul(body, Math.min(body.length, BINARY_PROBE_BYTES))) {
                throw new FileToolException(FileToolErrorCode.BINARY_FILE, "目标文件是二进制文件");
            }
            String content = decode(body, encoding.charset());
            if (encoding.charset() != StandardCharsets.UTF_8 && content.indexOf('\0') >= 0) {
                throw new FileToolException(FileToolErrorCode.BINARY_FILE, "目标文件是二进制文件");
            }
            return new TextDocument(content, encoding.charset(), encoding.bom(), detectNewline(content), bytes.length, fingerprint(path, bytes));
        } catch (FileToolException e) {
            throw e;
        } catch (IOException e) {
            throw new FileToolException(FileToolErrorCode.FILE_READ_FAILED, "读取文件失败", e);
        }
    }

    public byte[] encode(String content, Charset charset, byte[] bom, String newline) {
        String normalized = normalizeContent(content, newline);
        byte[] body = normalized.getBytes(charset);
        byte[] bytes = new byte[bom.length + body.length];
        System.arraycopy(bom, 0, bytes, 0, bom.length);
        System.arraycopy(body, 0, bytes, bom.length, body.length);
        if (bytes.length > FileToolSupport.MAX_FILE_BYTES) {
            throw new FileToolException(FileToolErrorCode.FILE_TOO_LARGE, "最终文件大小不能超过 10 MiB");
        }
        return bytes;
    }

    public void atomicWrite(Path target, byte[] bytes, FileFingerprint expectedFingerprint, boolean replaceExisting) {
        Path parent = target.getParent();
        if (parent == null) {
            throw new FileToolException(FileToolErrorCode.INVALID_PATH, "无法解析目标文件父目录");
        }
        Path temp = null;
        try {
            temp = Files.createTempFile(parent, ".mboo-", ".tmp");
            Files.write(temp, bytes);
            if (replaceExisting) {
                copyAccessAttributes(target, temp);
            }
            verifyFingerprint(target, expectedFingerprint);
            if (replaceExisting) {
                Files.move(temp, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            } else {
                Files.move(temp, target, StandardCopyOption.ATOMIC_MOVE);
            }
            temp = null;
        } catch (AtomicMoveNotSupportedException e) {
            throw new FileToolException(FileToolErrorCode.ATOMIC_REPLACE_UNSUPPORTED, "当前文件系统不支持原子替换", e);
        } catch (FileAlreadyExistsException e) {
            throw new FileToolException(FileToolErrorCode.FILE_CHANGED, "目标文件在写入期间已被创建", e);
        } catch (AccessDeniedException e) {
            throw new FileToolException(FileToolErrorCode.FILE_WRITE_FAILED, "没有权限写入目标文件", e);
        } catch (FileToolException e) {
            throw e;
        } catch (IOException e) {
            throw new FileToolException(FileToolErrorCode.FILE_WRITE_FAILED, "写入文件失败", e);
        } finally {
            if (temp != null) {
                try {
                    Files.deleteIfExists(temp);
                } catch (IOException ignored) {
                    // 临时文件清理失败不覆盖原始错误。
                }
            }
        }
    }

    public FileFingerprint missingFingerprint() {
        return new FileFingerprint(false, 0, 0, null, "");
    }

    public String normalizeContent(String content, String newline) {
        return content.replace("\r\n", "\n").replace('\r', '\n').replace("\n", newline);
    }

    public List<String> lines(String content) {
        if (content.isEmpty()) {
            return List.of();
        }
        String[] values = content.split("\\r\\n|\\n|\\r", -1);
        int length = values.length;
        if (length > 0 && values[length - 1].isEmpty() && endsWithNewline(content)) {
            length--;
        }
        return List.of(Arrays.copyOf(values, length));
    }

    private EncodingInfo detectEncoding(byte[] bytes) {
        if (startsWith(bytes, UTF8_BOM)) {
            return new EncodingInfo(StandardCharsets.UTF_8, UTF8_BOM, UTF8_BOM.length);
        }
        if (startsWith(bytes, UTF16_LE_BOM)) {
            return new EncodingInfo(StandardCharsets.UTF_16LE, UTF16_LE_BOM, UTF16_LE_BOM.length);
        }
        if (startsWith(bytes, UTF16_BE_BOM)) {
            return new EncodingInfo(StandardCharsets.UTF_16BE, UTF16_BE_BOM, UTF16_BE_BOM.length);
        }
        return new EncodingInfo(StandardCharsets.UTF_8, new byte[0], 0);
    }

    private String decode(byte[] bytes, Charset charset) {
        try {
            CharBuffer chars = charset.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes));
            return chars.toString();
        } catch (CharacterCodingException e) {
            throw new FileToolException(FileToolErrorCode.UNSUPPORTED_ENCODING, "文件编码不受支持，仅支持 UTF-8 和带 BOM 的 UTF-16", e);
        }
    }

    private boolean containsNul(byte[] bytes, int length) {
        for (int i = 0; i < length; i++) {
            if (bytes[i] == 0) {
                return true;
            }
        }
        return false;
    }

    private String detectNewline(String content) {
        int crlf = 0;
        int lf = 0;
        int cr = 0;
        String first = null;
        for (int i = 0; i < content.length(); i++) {
            char current = content.charAt(i);
            if (current == '\r') {
                if (i + 1 < content.length() && content.charAt(i + 1) == '\n') {
                    crlf++;
                    i++;
                    if (first == null) first = "\r\n";
                } else {
                    cr++;
                    if (first == null) first = "\r";
                }
            } else if (current == '\n') {
                lf++;
                if (first == null) first = "\n";
            }
        }
        int max = Math.max(crlf, Math.max(lf, cr));
        if (max == 0) return "\n";
        if ((crlf == max ? 1 : 0) + (lf == max ? 1 : 0) + (cr == max ? 1 : 0) > 1) return first;
        return crlf == max ? "\r\n" : lf == max ? "\n" : "\r";
    }

    private boolean endsWithNewline(String content) {
        return content.endsWith("\n") || content.endsWith("\r");
    }

    private boolean startsWith(byte[] bytes, byte[] prefix) {
        if (bytes.length < prefix.length) return false;
        for (int i = 0; i < prefix.length; i++) {
            if (bytes[i] != prefix[i]) return false;
        }
        return true;
    }

    private FileFingerprint fingerprint(Path path, byte[] bytes) throws IOException {
        BasicFileAttributes attributes = Files.readAttributes(path, BasicFileAttributes.class);
        return new FileFingerprint(true, attributes.size(), attributes.lastModifiedTime().toMillis(), attributes.fileKey(), sha256(bytes));
    }

    private void verifyFingerprint(Path target, FileFingerprint expected) throws IOException {
        if (!expected.exists()) {
            if (Files.exists(target)) {
                throw new FileToolException(FileToolErrorCode.FILE_CHANGED, "目标文件在写入期间发生变化");
            }
            return;
        }
        if (Files.notExists(target) || !Files.isRegularFile(target)) {
            throw new FileToolException(FileToolErrorCode.FILE_CHANGED, "目标文件在写入期间发生变化");
        }
        byte[] currentBytes = Files.readAllBytes(target);
        FileFingerprint current = fingerprint(target, currentBytes);
        if (!expected.equals(current)) {
            throw new FileToolException(FileToolErrorCode.FILE_CHANGED, "目标文件在写入期间发生变化");
        }
    }

    private String sha256(byte[] bytes) {
        try {
            return java.util.HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("运行环境缺少 SHA-256", e);
        }
    }

    private void copyAccessAttributes(Path source, Path target) throws IOException {
        PosixFileAttributeView posix = Files.getFileAttributeView(source, PosixFileAttributeView.class);
        if (posix != null) {
            Set<PosixFilePermission> permissions = posix.readAttributes().permissions();
            Files.setPosixFilePermissions(target, permissions);
        }
        AclFileAttributeView acl = Files.getFileAttributeView(source, AclFileAttributeView.class);
        if (acl != null) {
            List<AclEntry> entries = acl.getAcl();
            AclFileAttributeView targetAcl = Files.getFileAttributeView(target, AclFileAttributeView.class);
            if (targetAcl == null) throw new IOException("临时文件不支持 ACL");
            targetAcl.setAcl(entries);
        }
        FileOwnerAttributeView owner = Files.getFileAttributeView(source, FileOwnerAttributeView.class);
        FileOwnerAttributeView targetOwner = Files.getFileAttributeView(target, FileOwnerAttributeView.class);
        if (owner != null && targetOwner != null) {
            targetOwner.setOwner(owner.getOwner());
        }
        DosFileAttributeView dos = Files.getFileAttributeView(source, DosFileAttributeView.class);
        if (dos != null) {
            DosFileAttributes attributes = dos.readAttributes();
            DosFileAttributeView targetDos = Files.getFileAttributeView(target, DosFileAttributeView.class);
            if (targetDos == null) throw new IOException("临时文件不支持 DOS 属性");
            targetDos.setArchive(attributes.isArchive());
            targetDos.setHidden(attributes.isHidden());
            targetDos.setSystem(attributes.isSystem());
            targetDos.setReadOnly(attributes.isReadOnly());
        }
    }

    private record EncodingInfo(Charset charset, byte[] bom, int bomLength) {
    }

    public record TextDocument(String content, Charset charset, byte[] bom, String newline, long byteLength, FileFingerprint fingerprint) {
    }

    public record FileFingerprint(boolean exists, long size, long lastModified, Object fileKey, String sha256) {
    }
}
