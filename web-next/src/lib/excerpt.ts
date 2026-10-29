/* Card excerpts (Wave 6): the first sentence of a robot's recorded
   catalog description, verbatim — an excerpt of data that already
   exists, never a new sentence about the robot. The split is
   conservative: a sentence ends at ., ! or ? only when followed by
   whitespace or the end of the text, so decimals ("1.32 m") and
   abbreviations inside a sentence do not cut it short. */
export function firstSentence(text: string): string {
  const m = text.match(/^[\s\S]*?[.!?](?=\s|$)/);
  return (m ? m[0] : text).trim();
}
