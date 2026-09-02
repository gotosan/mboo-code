export type UserMessageContentSegment =
  | { type: "skill"; name: string }
  | { type: "text"; text: string };

const SKILL_TAG_PATTERN = /<skill>([a-z0-9]+(?:-[a-z0-9]+)*)<\/skill>/g;

/**
 * 只转换发送器生成的合法 Skill 协议，避免展示层误吞用户手写的尖括号内容。
 */
export function parseUserMessageContent(content: string): UserMessageContentSegment[] {
  const segments: UserMessageContentSegment[] = [];
  let textStart = 0;

  for (const match of content.matchAll(SKILL_TAG_PATTERN)) {
    const matchStart = match.index;
    if (matchStart > textStart) {
      segments.push({ type: "text", text: content.slice(textStart, matchStart) });
    }
    segments.push({ type: "skill", name: match[1] });
    textStart = matchStart + match[0].length;
  }

  if (textStart < content.length) {
    segments.push({ type: "text", text: content.slice(textStart) });
  }

  return segments.length > 0 ? segments : [{ type: "text", text: content }];
}
