import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

export async function promptLine(question: string, defaultValue?: string): Promise<string> {
  const rl = readline.createInterface({ input, output });
  try {
    const suffix = defaultValue ? ` [${defaultValue}]` : '';
    const answer = await rl.question(`${question}${suffix}: `);
    const trimmed = answer.trim();
    if (!trimmed && defaultValue) return defaultValue;
    return trimmed;
  } finally {
    rl.close();
  }
}

export async function promptSecret(question: string): Promise<string> {
  const rl = readline.createInterface({ input, output });
  try {
    return (await rl.question(`${question}: `)).trim();
  } finally {
    rl.close();
  }
}
