package com.yu.mboocode.llm.tool.file;

import com.github.difflib.DiffUtils;
import com.github.difflib.UnifiedDiffUtils;
import com.github.difflib.patch.AbstractDelta;
import com.github.difflib.patch.Patch;
import com.yu.mboocode.llm.tool.ToolTextTruncator;
import jakarta.annotation.Resource;
import org.springframework.stereotype.Component;

import java.util.List;

@Component
public class FileDiffSupport {
    public static final int LLM_DIFF_MAX_LENGTH = 12_000;
    @Resource
    private TextFileSupport textFileSupport;
    @Resource
    private ToolTextTruncator toolTextTruncator;

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
        ToolTextTruncator.TruncatedText truncated = toolTextTruncator.truncateMiddle(fullDiff, LLM_DIFF_MAX_LENGTH);
        return new DiffResult(added, deleted, truncated.text(), truncated.truncated());
    }

    public ToolTextTruncator.TruncatedText truncateMiddle(String text, int maxLength) {
        return toolTextTruncator.truncateMiddle(text, maxLength);
    }

    public record DiffResult(int addedLines, int deletedLines, String diff, boolean truncated) {
    }

}
