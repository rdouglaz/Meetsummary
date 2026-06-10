export type Sentiment = 'positive' | 'negative' | 'neutral';

const POSITIVE = new Set([
  'great','good','excellent','perfect','wonderful','fantastic','amazing','awesome','love','happy',
  'agree','agreed','yes','absolutely','definitely','sure','exactly','right','correct','clear',
  'thanks','thank','appreciate','helpful','pleased','glad','excited','confident','success',
  'progress','improve','improved','improvement','solution','solved','works','working','done',
  'completed','achieved','accomplished','ready','approved','approve','support','supported',
  'efficient','effective','productive','positive','benefit','benefits','opportunity','win',
  'innovative','creative','brilliant','smart','clever','nice','pleased','delighted','enthusiastic',
]);

const NEGATIVE = new Set([
  'bad','terrible','awful','horrible','wrong','fail','failed','failure','issue','issues',
  'problem','problems','concern','concerns','worried','worry','fear','afraid','nervous',
  'disagree','no','not','never','delay','delayed','delayed','block','blocked','stuck',
  'difficult','hard','confusing','confused','unclear','complicated','missing','missed',
  'risk','risks','danger','danger','loss','lost','broke','broken','crash','crashes',
  'error','errors','bug','bugs','reject','rejected','reject','cancel','cancelled',
  'behind','late','slow','weak','poor','disappointing','disappointed','frustrated','frustrating',
  'overwhelmed','overload','deadline','overdue','incomplete','unfinished','unresolved',
]);

const INTENSIFIERS = new Set(['very','really','extremely','quite','absolutely','totally','completely','highly']);

export function analyzeSentiment(text: string): Sentiment {
  const words = text.toLowerCase().replace(/[^a-z\s']/g, ' ').split(/\s+/).filter(Boolean);
  let score = 0;
  let multiplier = 1;

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (INTENSIFIERS.has(w)) { multiplier = 2; continue; }
    if (w === "n't" || w === 'not' || w === 'never') { multiplier = -1 * Math.abs(multiplier); continue; }
    if (POSITIVE.has(w)) { score += multiplier; }
    else if (NEGATIVE.has(w)) { score -= multiplier; }
    multiplier = 1;
  }

  if (score >= 1) return 'positive';
  if (score <= -1) return 'negative';
  return 'neutral';
}

export function sentimentEmoji(s: Sentiment): string {
  if (s === 'positive') return '😊';
  if (s === 'negative') return '😟';
  return '😐';
}

export function sentimentColor(s: Sentiment): string {
  if (s === 'positive') return 'text-emerald-500';
  if (s === 'negative') return 'text-red-500';
  return 'text-muted-foreground';
}

export function sentimentBg(s: Sentiment): string {
  if (s === 'positive') return 'bg-emerald-500/10';
  if (s === 'negative') return 'bg-red-500/10';
  return 'bg-muted';
}

export function aggregateSentiment(sentiments: Sentiment[]): { positive: number; negative: number; neutral: number; overall: Sentiment } {
  const counts = { positive: 0, negative: 0, neutral: 0 };
  for (const s of sentiments) counts[s]++;
  const total = sentiments.length || 1;
  const overall: Sentiment = counts.positive > counts.negative + counts.neutral * 0.5
    ? 'positive'
    : counts.negative > counts.positive + counts.neutral * 0.5
    ? 'negative'
    : 'neutral';
  return {
    positive: Math.round((counts.positive / total) * 100),
    negative: Math.round((counts.negative / total) * 100),
    neutral: Math.round((counts.neutral / total) * 100),
    overall,
  };
}
