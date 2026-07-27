package com.yu.mboocode.llm.tool.file;

import com.github.difflib.DiffUtils;
import com.github.difflib.UnifiedDiffUtils;
import com.github.difflib.patch.AbstractDelta;
import com.github.difflib.patch.Patch;
import org.springframework.stereotype.Component;

import java.util.List;

@Component
public class FileDiffSupport {
    public static final int LLM_DIFF_MAX_LENGTH = 12_000;
    public static final int EVENT_RESULT_MAX_LENGTH = 4_000;

    private final TextFileSupport textFileSupport;

    public FileDiffSupport(TextFileSupport textFileSupport) {
        this.textFileSupport = textFileSupport;
    }

    public DiffResult create(String path, String before, String after) {
        List<String> beforeLines = textFileSupport.lines(before);
        List<String> afterLines = textFileSupport.lines(after);
        Patch<String> patch = DiffUtils.diff(beforeLines, afterLines);
        List<String> diffLines = UnifiedDiffUtils.generateUnifiedDiff("a/" + path, "b/" + path, beforeLines, patch, 3);
        int added = 0;
        int deleted = 0;
        for (AbstractDelta<String> delta : patch.getDeltas()) {
            deleted += delta.getSource().size();
            added += delta.getTarget().size();
        }
        String fullDiff = String.join("\n", diffLines);
        TruncatedText truncated = truncateMiddle(fullDiff, LLM_DIFF_MAX_LENGTH);
        return new DiffResult(added, deleted, truncated.text(), truncated.truncated());
    }

    public TruncatedText truncateMiddle(String text, int maxLength) {
        if (text == null || text.length() <= maxLength) {
            return new TruncatedText(text == null ? "" : text, false);
        }
        if (maxLength <= 0) {
            return new TruncatedText("", true);
        }
        int omitted = text.length() - maxLength;
        String marker = "\n...（已截断，省略 " + omitted + " 个字符）...\n";
        if (marker.length() >= maxLength) {
            return new TruncatedText(marker.substring(0, maxLength), true);
        }
        int available = Math.max(0, maxLength - marker.length());
        omitted = text.length() - available;
        marker = "\n...（已截断，省略 " + omitted + " 个字符）...\n";
        available = Math.max(0, maxLength - marker.length());
        int head = available / 2;
        int tail = available - head;
        return new TruncatedText(text.substring(0, head) + marker + text.substring(text.length() - tail), true);
    }

    public record DiffResult(int addedLines, int deletedLines, String diff, boolean truncated) {
    }

    public record TruncatedText(String text, boolean truncated) {
    }
}
