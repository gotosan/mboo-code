export function getNextSkillSuggestionIndex(currentIndex: number, suggestionCount: number, direction: "up" | "down") {
  if (suggestionCount === 0) return 0;
  return (currentIndex + (direction === "down" ? 1 : -1) + suggestionCount) % suggestionCount;
}
