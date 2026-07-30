package com.yu.mboocode.agent.tool;

import java.util.ArrayDeque;
import java.util.Deque;

/**
 * 只保留输出头尾的固定内存收集器，避免进程无限输出占满堆内存。
 */
public class BoundedTextCollector {
    private final int maxCharacters;
    private final int maxLines;
    private final StringBuilder head;
    private final Deque<Character> tail;
    private long totalCharacters;
    private long totalLines;
    private boolean lastCharacterWasNewline;

    public BoundedTextCollector(int maxCharacters, int maxLines) {
        this.maxCharacters = maxCharacters;
        this.maxLines = maxLines;
        this.head = new StringBuilder(maxCharacters);
        this.tail = new ArrayDeque<>(maxCharacters);
    }

    public synchronized void append(char[] value, int offset, int length) {
        for (int index = offset; index < offset + length; index++) {
            char current = value[index];
            totalCharacters++;
            if (current == '\n') totalLines++;
            lastCharacterWasNewline = current == '\n';
            if (head.length() < maxCharacters) head.append(current);
            tail.addLast(current);
            if (tail.size() > maxCharacters) tail.removeFirst();
        }
    }

    public synchronized CollectedText finish(ToolTextTruncator truncator) {
        long lineCount = totalCharacters == 0 ? 0 : totalLines + (lastCharacterWasNewline ? 0 : 1);
        if (totalCharacters <= maxCharacters && lineCount <= maxLines) {
            return new CollectedText(head.toString(), false, 0, 0);
        }

        int retainedLineBudget = Math.max(2, maxLines - 3);
        int headLineBudget = retainedLineBudget / 2;
        String headText = limitHeadLines(head.toString(), headLineBudget);
        String tailText = limitTailLines(tailText(), retainedLineBudget - headLineBudget);
        int rawBudget = Math.max(0, maxCharacters - 80);
        int headBudget = rawBudget / 2;
        int tailBudget = rawBudget - headBudget;
        if (headText.length() > headBudget) headText = headText.substring(0, headBudget);
        if (tailText.length() > tailBudget) tailText = tailText.substring(tailText.length() - tailBudget);
        long omittedCharacters = Math.max(0, totalCharacters - headText.length() - tailText.length());
        String output = headText + truncator.marker(omittedCharacters) + tailText;
        ToolTextTruncator.TruncatedText limited = truncator.truncateMiddle(output, maxCharacters);
        long retainedLines = headText.lines().count() + tailText.lines().count();
        long omittedLines = Math.max(0, lineCount - retainedLines);
        return new CollectedText(limited.text(), true, omittedCharacters + limited.omittedCharacters(), omittedLines);
    }

    private String tailText() {
        StringBuilder value = new StringBuilder(tail.size());
        for (char current : tail) value.append(current);
        return value.toString();
    }

    private String limitHeadLines(String text, int limit) {
        int newlines = 0;
        for (int index = 0; index < text.length(); index++) {
            if (text.charAt(index) == '\n' && ++newlines >= limit) return text.substring(0, index + 1);
        }
        return text;
    }

    private String limitTailLines(String text, int limit) {
        int newlines = 0;
        for (int index = text.length() - 1; index >= 0; index--) {
            if (text.charAt(index) == '\n' && ++newlines >= limit) return text.substring(index + 1);
        }
        return text;
    }

    public record CollectedText(String text, boolean truncated, long omittedCharacters, long omittedLines) {
    }
}
