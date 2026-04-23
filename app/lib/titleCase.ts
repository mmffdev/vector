const SMALL_WORDS = new Set([
  "a", "an", "and", "as", "at", "but", "by", "en", "for", "if", "in", "nor",
  "of", "on", "or", "per", "so", "the", "to", "up", "v", "vs", "via", "yet",
]);

export function toTitleCase(input: string): string {
  if (!input) return input;
  const words = input.split(/(\s+)/);
  let wordIndex = 0;
  const totalWords = words.filter((w) => !/^\s+$/.test(w)).length;

  return words
    .map((segment) => {
      if (/^\s+$/.test(segment)) return segment;
      const isFirst = wordIndex === 0;
      const isLast = wordIndex === totalWords - 1;
      wordIndex += 1;
      return capitaliseWord(segment, isFirst || isLast);
    })
    .join("");
}

function capitaliseWord(word: string, force: boolean): string {
  if (/[A-Z]/.test(word.slice(1))) return word;
  const lower = word.toLowerCase();
  if (!force && SMALL_WORDS.has(lower)) return lower;
  return word
    .split("-")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1).toLowerCase() : part))
    .join("-");
}
