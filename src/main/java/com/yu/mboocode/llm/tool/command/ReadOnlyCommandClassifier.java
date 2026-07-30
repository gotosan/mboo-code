package com.yu.mboocode.llm.tool.command;

import com.yu.mboocode.llm.tool.command.ResolvedCommand.ShellType;
import jakarta.annotation.Resource;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

@Component
public class ReadOnlyCommandClassifier {
    @Resource
    private PosixCommandAnalyzer posixCommandAnalyzer;
    @Resource
    private PowerShellCommandAnalyzer powerShellCommandAnalyzer;

    private static final class PosixOptions {
        private static final Set<String> LS_LONG_OPTIONS = Set.of(
            "--all", "--almost-all", "--author", "--classify", "--color", "--directory", "--dereference-command-line",
            "--file-type", "--full-time", "--group-directories-first", "--help", "--hide-control-chars", "--human-readable",
            "--inode", "--literal", "--no-group", "--numeric-uid-gid", "--quote-name", "--recursive", "--reverse",
            "--size", "--time", "--version", "--width"
        );
        private static final Set<String> CAT_OPTIONS = Set.of(
            "-A", "-b", "-e", "-E", "-n", "-s", "-t", "-T", "-u", "-v", "--show-all", "--number-nonblank",
            "--show-ends", "--number", "--squeeze-blank", "--show-tabs", "--show-nonprinting", "--help", "--version"
        );
        private static final Set<String> WC_OPTIONS = Set.of(
            "-c", "-m", "-l", "-L", "-w", "--bytes", "--chars", "--lines", "--max-line-length", "--words", "--help", "--version"
        );
        private static final Set<String> GREP_OPTIONS = Set.of(
            "-E", "-F", "-G", "-P", "-e", "-f", "-i", "-v", "-w", "-x", "-n", "-H", "-h", "-o", "-q", "-s",
            "-r", "-R", "-l", "-L", "-c", "-m", "-A", "-B", "-C", "--extended-regexp", "--fixed-strings",
            "--basic-regexp", "--perl-regexp", "--regexp", "--file", "--ignore-case", "--invert-match", "--word-regexp",
            "--line-regexp", "--line-number", "--with-filename", "--no-filename", "--only-matching", "--quiet", "--no-messages",
            "--recursive", "--dereference-recursive", "--files-with-matches", "--files-without-match", "--count", "--max-count",
            "--after-context", "--before-context", "--context", "--include", "--exclude", "--exclude-dir", "--color", "--colour",
            "--binary-files", "--text", "--byte-offset", "--initial-tab", "--null", "--help", "--version"
        );
        private static final Set<String> GREP_VALUE_OPTIONS = Set.of(
            "-e", "-f", "-m", "-A", "-B", "-C", "--regexp", "--file", "--max-count", "--after-context",
            "--before-context", "--context", "--include", "--exclude", "--exclude-dir", "--color", "--colour", "--binary-files"
        );
        private static final Set<String> RG_OPTIONS = Set.of(
            "-i", "-s", "-S", "-F", "-w", "-x", "-v", "-n", "-N", "-H", "-I", "-l", "--files-with-matches",
            "--files-without-match", "-c", "--count-matches", "-o", "-q", "-u", "--hidden", "--no-ignore", "--no-ignore-vcs",
            "--no-ignore-parent", "--no-ignore-global", "--follow", "--files", "--type-list", "--stats", "--json", "--pcre2",
            "--no-pcre2-unicode", "--multiline", "--multiline-dotall", "--crlf", "--text", "--binary", "--trim", "--passthru",
            "--sort", "--sortr", "--glob", "--iglob", "--type", "--type-not", "--max-count", "--max-depth", "--max-filesize",
            "--context", "--before-context", "--after-context", "--color", "--colors", "--encoding", "--engine", "--regexp",
            "--file", "--replace", "--threads", "--help", "--version"
        );
        private static final Set<String> RG_VALUE_OPTIONS = Set.of(
            "--sort", "--sortr", "--glob", "--iglob", "--type", "--type-not", "--max-count", "--max-depth", "--max-filesize",
            "--context", "--before-context", "--after-context", "--color", "--colors", "--encoding", "--engine", "--regexp",
            "--file", "--replace", "--threads"
        );
        private static final Set<String> WHICH_OPTIONS = Set.of(
            "-a", "-s", "--all", "--skip-alias", "--skip-dot", "--skip-functions", "--skip-tilde", "--show-dot",
            "--show-tilde", "--tty-only", "--version", "--help"
        );
    }

    private static final class PowerShellOptions {
        private static final Map<String, String> ALIASES = Map.ofEntries(
            Map.entry("pwd", "get-location"), Map.entry("ls", "get-childitem"), Map.entry("dir", "get-childitem"),
            Map.entry("gci", "get-childitem"), Map.entry("cat", "get-content"), Map.entry("type", "get-content"),
            Map.entry("gc", "get-content"), Map.entry("gcm", "get-command"), Map.entry("echo", "write-output"),
            Map.entry("write", "write-output"), Map.entry("measure", "measure-object")
        );
    }

    private static final class GitOptions {
        private static final Set<String> STATUS = Set.of(
            "-s", "-b", "--short", "--branch", "--show-stash", "--porcelain", "--long", "--verbose", "-v", "-u",
            "--untracked-files", "--ignore-submodules", "--ignored", "--column", "--no-column", "--ahead-behind",
            "--no-ahead-behind", "--renames", "--no-renames", "--find-renames"
        );
        private static final Set<String> DIFF = Set.of(
            "--cached", "--staged", "--stat", "--numstat", "--shortstat", "--dirstat", "--summary", "--name-only",
            "--name-status", "--check", "--full-index", "--binary", "--abbrev", "-p", "-u", "-U", "--unified", "-w",
            "--ignore-all-space", "-b", "--ignore-space-change", "--ignore-space-at-eol", "--ignore-blank-lines",
            "--no-ext-diff", "--no-textconv", "--submodule", "--color", "--no-color", "--word-diff", "--word-diff-regex",
            "--color-words", "--relative", "--src-prefix", "--dst-prefix", "--line-prefix", "--no-prefix", "--inter-hunk-context"
        );
        private static final Set<String> LOG = Set.of(
            "--oneline", "--decorate", "--no-decorate", "--stat", "--shortstat", "--name-only", "--name-status", "--graph",
            "--all", "--branches", "--tags", "--remotes", "--since", "--after", "--until", "--before", "--author",
            "--committer", "--grep", "--regexp-ignore-case", "--merges", "--no-merges", "--first-parent", "--reverse",
            "--topo-order", "--date-order", "--format", "--pretty", "--abbrev-commit", "--no-abbrev-commit", "--max-count",
            "-n", "--skip", "--no-patch", "-p", "--show-signature", "--no-ext-diff", "--no-textconv", "--color", "--no-color"
        );
        private static final Set<String> SHOW = Set.of(
            "--stat", "--shortstat", "--name-only", "--name-status", "--format", "--pretty", "--abbrev-commit",
            "--no-abbrev-commit", "--no-patch", "-p", "--show-signature", "--no-ext-diff", "--no-textconv",
            "--color", "--no-color", "--binary", "--full-index"
        );
        private static final Set<String> DISPLAY_VALUES = Set.of(
            "-U", "--unified", "--abbrev", "--submodule", "--color", "--word-diff", "--word-diff-regex", "--color-words",
            "--relative", "--src-prefix", "--dst-prefix", "--line-prefix", "--inter-hunk-context", "--since", "--after",
            "--until", "--before", "--author", "--committer", "--grep", "--format", "--pretty", "--max-count", "-n", "--skip"
        );
    }

    public CommandAnalysis analyze(ResolvedCommand command) {
        try {
            return command.shell().type() == ShellType.POWERSHELL ? powerShellCommandAnalyzer.analyze(command) : posixCommandAnalyzer.analyze(command.command());
        } catch (RuntimeException e) {
            return CommandAnalysis.unsafe();
        }
    }

    public boolean isReadOnly(ResolvedCommand command, CommandAnalysis analysis) {
        if (!analysis.parsed() || analysis.compound() || analysis.tokens().isEmpty()) return false;
        return command.shell().type() == ShellType.POWERSHELL ? isPowerShellReadOnly(analysis.tokens()) : isPosixReadOnly(analysis.tokens());
    }

    private boolean isPosixReadOnly(List<String> tokens) {
        String name = tokens.getFirst();
        if (!isBareCommand(name)) return false;
        List<String> arguments = tokens.subList(1, tokens.size());
        return switch (name) {
            case "pwd" -> allIn(arguments, Set.of("-L", "-P", "--logical", "--physical"));
            case "ls" -> validateLs(arguments);
            case "cat" -> validateOptions(arguments, PosixOptions.CAT_OPTIONS, Set.of());
            case "head" -> validateHeadTail(arguments, false);
            case "tail" -> validateHeadTail(arguments, true);
            case "wc" -> validateOptions(arguments, PosixOptions.WC_OPTIONS, Set.of());
            case "grep" -> validateOptions(arguments, PosixOptions.GREP_OPTIONS, PosixOptions.GREP_VALUE_OPTIONS);
            case "rg" -> validateRg(arguments);
            case "which" -> validateOptions(arguments, PosixOptions.WHICH_OPTIONS, Set.of());
            case "command" -> arguments.size() >= 2 && "-v".equals(arguments.getFirst())
                    && arguments.subList(1, arguments.size()).stream().allMatch(this::isBareCommand);
            case "git" -> validateGit(arguments);
            default -> false;
        };
    }

    private boolean isPowerShellReadOnly(List<String> tokens) {
        String rawName = tokens.getFirst().toLowerCase(Locale.ROOT);
        String name = PowerShellOptions.ALIASES.getOrDefault(rawName, rawName);
        List<String> arguments = tokens.subList(1, tokens.size());
        if ("git".equals(name)) return validateGit(arguments);
        return switch (name) {
            case "get-location" -> validatePowerShellOptions(arguments, Set.of("-psprovider", "-psdrive"));
            case "get-childitem" -> validatePowerShellOptions(arguments, Set.of(
                    "-path", "-literalpath", "-filter", "-include", "-exclude", "-depth", "-name", "-force", "-recurse",
                    "-file", "-directory", "-hidden", "-readonly", "-system", "-attributes", "-follow-symlink"));
            case "get-content" -> validatePowerShellOptions(arguments, Set.of(
                    "-path", "-literalpath", "-filter", "-include", "-exclude", "-readcount", "-totalcount", "-tail",
                    "-encoding", "-delimiter", "-raw", "-force"));
            case "select-string" -> validatePowerShellOptions(arguments, Set.of(
                    "-pattern", "-path", "-literalpath", "-inputobject", "-encoding", "-include", "-exclude", "-simplematch",
                    "-casesensitive", "-quiet", "-list", "-notmatch", "-allmatches", "-context", "-raw", "-nomatch"));
            case "measure-object" -> validatePowerShellOptions(arguments, Set.of(
                    "-inputobject", "-property", "-sum", "-average", "-maximum", "-minimum", "-line", "-word",
                    "-character", "-ignorewhitespace", "-allstats"));
            case "test-path" -> validatePowerShellOptions(arguments, Set.of(
                    "-path", "-literalpath", "-filter", "-include", "-exclude", "-pathtype", "-isvalid", "-newerthan", "-olderthan"));
            case "get-command" -> validatePowerShellOptions(arguments, Set.of(
                    "-name", "-verb", "-noun", "-module", "-commandtype", "-totalcount", "-syntax", "-all", "-listimported",
                    "-parametername", "-parametertype", "-showcommandinfo"));
            case "write-output" -> arguments.stream().noneMatch(argument -> argument.startsWith("-") && !"-noenumerate".equalsIgnoreCase(argument));
            default -> false;
        };
    }

    private boolean validateLs(List<String> arguments) {
        for (int i = 0; i < arguments.size(); i++) {
            String argument = arguments.get(i);
            if (!argument.startsWith("-") || "-".equals(argument)) continue;
            if (argument.startsWith("--")) {
                String option = optionName(argument);
                if (!PosixOptions.LS_LONG_OPTIONS.contains(option)) return false;
                if (Set.of("--color", "--hide", "--ignore", "--quoting-style", "--sort", "--time", "--time-style", "--width").contains(option)
                        && !hasInlineValue(argument) && ++i >= arguments.size()) return false;
            } else if (!argument.substring(1).chars().allMatch(value -> "1aAbBCdDfFgGhHiklLmnopqQrRsStTuUvxXZ".indexOf(value) >= 0)) {
                return false;
            }
        }
        return true;
    }

    private boolean validateHeadTail(List<String> arguments, boolean tail) {
        Set<String> flags = Set.of("-q", "-v", "--quiet", "--silent", "--verbose", "-z", "--zero-terminated");
        Set<String> values = Set.of("-n", "-c", "--lines", "--bytes");
        for (int i = 0; i < arguments.size(); i++) {
            String argument = arguments.get(i);
            if (tail && ("-f".equals(argument) || "-F".equals(argument) || argument.startsWith("--follow")
                    || argument.startsWith("--retry") || argument.startsWith("--pid"))) return false;
            if (!argument.startsWith("-") || "-".equals(argument) || argument.matches("-?\\d+")) continue;
            String option = optionName(argument);
            if (flags.contains(option)) continue;
            if (!values.contains(option) || !hasInlineValue(argument) && ++i >= arguments.size()) return false;
        }
        return true;
    }

    private boolean validateRg(List<String> arguments) {
        for (String argument : arguments) {
            String lower = argument.toLowerCase(Locale.ROOT);
            if (lower.equals("--pre") || lower.startsWith("--pre=") || lower.equals("--pre-glob") || lower.startsWith("--pre-glob=")) return false;
        }
        return validateOptions(arguments, PosixOptions.RG_OPTIONS, PosixOptions.RG_VALUE_OPTIONS);
    }

    private boolean validateGit(List<String> arguments) {
        if (arguments.isEmpty() || arguments.getFirst().startsWith("-")) return false;
        String subcommand = arguments.getFirst().toLowerCase(Locale.ROOT);
        List<String> rest = arguments.subList(1, arguments.size());
        if (rest.stream().anyMatch(value -> value.equals("--ext-diff") || value.equals("--textconv")
                || value.startsWith("--output") || value.equals("-o"))) return false;
        return switch (subcommand) {
            case "status" -> validateOptions(rest, GitOptions.STATUS,
                    Set.of("-u", "--untracked-files", "--ignore-submodules", "--ignored", "--column", "--find-renames"));
            case "diff" -> disablesExternalDiff(rest) && validateGitDisplay(rest, GitOptions.DIFF);
            case "log" -> (!requestsPatch(rest) || disablesExternalDiff(rest)) && validateGitDisplay(rest, GitOptions.LOG);
            case "show" -> (rest.contains("--no-patch") || disablesExternalDiff(rest)) && validateGitDisplay(rest, GitOptions.SHOW);
            case "branch" -> rest.size() == 1 && "--show-current".equals(rest.getFirst());
            default -> false;
        };
    }

    private boolean disablesExternalDiff(List<String> arguments) {
        return arguments.contains("--no-ext-diff") && arguments.contains("--no-textconv");
    }

    private boolean requestsPatch(List<String> arguments) {
        Set<String> patchOptions = Set.of("-p", "--stat", "--shortstat", "--name-only", "--name-status");
        return arguments.stream().map(this::optionName).anyMatch(patchOptions::contains);
    }

    private boolean validateGitDisplay(List<String> arguments, Set<String> options) {
        for (int i = 0; i < arguments.size(); i++) {
            String argument = arguments.get(i);
            if (!argument.startsWith("-") || "-".equals(argument)) continue;
            String option = optionName(argument);
            if (!options.contains(option)) return false;
            if (GitOptions.DISPLAY_VALUES.contains(option) && !hasInlineValue(argument) && ++i >= arguments.size()) return false;
        }
        return true;
    }

    private boolean validateOptions(List<String> arguments, Set<String> options, Set<String> valueOptions) {
        for (int i = 0; i < arguments.size(); i++) {
            String argument = arguments.get(i);
            if (!argument.startsWith("-") || "-".equals(argument) || "--".equals(argument)) continue;
            String option = optionName(argument);
            if (!options.contains(option)) return false;
            if (valueOptions.contains(option) && !hasInlineValue(argument) && ++i >= arguments.size()) return false;
        }
        return true;
    }

    private boolean validatePowerShellOptions(List<String> arguments, Set<String> options) {
        for (String argument : arguments) {
            if (!argument.startsWith("-") || "-".equals(argument)) continue;
            if (!options.contains(optionName(argument).toLowerCase(Locale.ROOT))) return false;
        }
        return true;
    }

    private boolean allIn(List<String> arguments, Set<String> allowed) {
        return arguments.stream().allMatch(allowed::contains);
    }

    private boolean isBareCommand(String value) {
        return value.matches("[A-Za-z0-9._+-]+");
    }

    private String optionName(String argument) {
        int equals = argument.indexOf('=');
        return equals < 0 ? argument : argument.substring(0, equals);
    }

    private boolean hasInlineValue(String argument) {
        return argument.indexOf('=') > 0;
    }

    public record CommandAnalysis(boolean parsed, boolean compound, List<String> tokens) {
        public CommandAnalysis {
            tokens = List.copyOf(tokens);
        }

        public static CommandAnalysis unsafe() {
            return new CommandAnalysis(false, true, List.of());
        }
    }
}
