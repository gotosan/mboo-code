type SkillBadgeProps = {
  name: string;
};

export function SkillBadge({ name }: SkillBadgeProps) {
  return (
    <span
      className="mr-1.5 inline-flex max-w-full translate-y-px items-center gap-1 rounded-[4px] border border-accent/25 bg-panel px-1.5 py-0.5 align-baseline text-[11px] font-medium leading-4 text-accent shadow-[inset_0_1px_0_rgb(255_255_255/0.7)]"
      aria-label={`Skill：${name}`}
      title={`Skill：${name}`}
    >
      <span aria-hidden className="text-[10px] text-text-3">/</span>
      <span className="truncate">{name}</span>
    </span>
  );
}
