package com.yu.mboocode.agent.tool.network;

import org.springframework.stereotype.Component;

import java.net.Inet4Address;
import java.net.Inet6Address;
import java.net.InetAddress;

@Component
public class NetworkAddressClassifier {
    public AddressClass classify(InetAddress address) {
        byte[] bytes = address.getAddress();
        if (address instanceof Inet6Address && isIpv4Mapped(bytes)) {
            byte[] mapped = new byte[]{bytes[12], bytes[13], bytes[14], bytes[15]};
            return classifyIpv4(mapped);
        }
        if (address instanceof Inet4Address) return classifyIpv4(bytes);
        return classifyIpv6(bytes);
    }

    private AddressClass classifyIpv4(byte[] bytes) {
        int first = unsigned(bytes[0]);
        int second = unsigned(bytes[1]);
        int third = unsigned(bytes[2]);
        int fourth = unsigned(bytes[3]);
        if (first == 169 && second == 254 && third == 169 && fourth == 254) return AddressClass.HARD_DENY;
        if (first == 169 && second == 254 && third == 170 && fourth == 2) return AddressClass.HARD_DENY;
        if (first == 100 && second == 100 && third == 100 && fourth == 200) return AddressClass.HARD_DENY;
        if (first == 0 || first >= 224 || (first == 255 && second == 255 && third == 255 && fourth == 255)) return AddressClass.HARD_DENY;
        if (first == 192 && second == 0 && (third == 0 || third == 2)) return AddressClass.HARD_DENY;
        if (first == 198 && (second == 18 || second == 19 || second == 51 && third == 100)) return AddressClass.HARD_DENY;
        if (first == 203 && second == 0 && third == 113) return AddressClass.HARD_DENY;
        if (first == 127 || first == 10 || first == 192 && second == 168 || first == 172 && second >= 16 && second <= 31) return AddressClass.PRIVATE;
        if (first == 169 && second == 254 || first == 100 && second >= 64 && second <= 127) return AddressClass.PRIVATE;
        return AddressClass.PUBLIC;
    }

    private AddressClass classifyIpv6(byte[] bytes) {
        if (allZero(bytes)) return AddressClass.HARD_DENY;
        if (matches(bytes, new int[]{0xfd, 0x00, 0x0e, 0xc2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x02, 0x54}, 128)) return AddressClass.HARD_DENY;
        if (unsigned(bytes[0]) == 0xff || matches(bytes, new int[]{0x20, 0x01, 0x0d, 0xb8}, 32)) return AddressClass.HARD_DENY;
        if (isLoopback(bytes) || (unsigned(bytes[0]) & 0xfe) == 0xfc || unsigned(bytes[0]) == 0xfe && (unsigned(bytes[1]) & 0xc0) == 0x80) return AddressClass.PRIVATE;
        if (unsigned(bytes[0]) == 0xfe && (unsigned(bytes[1]) & 0xc0) == 0xc0) return AddressClass.HARD_DENY;
        return AddressClass.PUBLIC;
    }

    private boolean matches(byte[] bytes, int[] prefix, int bits) {
        int fullBytes = bits / 8;
        for (int index = 0; index < fullBytes; index++) {
            if (unsigned(bytes[index]) != prefix[index]) return false;
        }
        return true;
    }

    private boolean isIpv4Mapped(byte[] bytes) {
        if (bytes.length != 16) return false;
        for (int index = 0; index < 10; index++) if (bytes[index] != 0) return false;
        return unsigned(bytes[10]) == 0xff && unsigned(bytes[11]) == 0xff;
    }

    private boolean allZero(byte[] bytes) {
        for (byte value : bytes) if (value != 0) return false;
        return true;
    }

    private boolean isLoopback(byte[] bytes) {
        for (int index = 0; index < bytes.length - 1; index++) if (bytes[index] != 0) return false;
        return bytes[bytes.length - 1] == 1;
    }

    private int unsigned(byte value) {
        return Byte.toUnsignedInt(value);
    }

    public enum AddressClass {
        PUBLIC,
        PRIVATE,
        HARD_DENY
    }
}
