import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))
export const clone = <T,>(value: T): T => structuredClone(value)
export const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
export async function mapLimited<T, R>(values: T[], limit: number, transform: (value: T) => Promise<R>): Promise<R[]> {
  const result: R[] = new Array(values.length)
  let next = 0
  await Promise.all(Array.from({length: Math.min(limit, values.length)}, async () => {
    while (next < values.length) {
      const index = next++
      result[index] = await transform(values[index])
    }
  }))
  return result
}

export async function copyText(value: string) {
  await navigator.clipboard.writeText(value)
}
