import { parse, stringify } from 'yaml'

export function parseYaml<T = unknown>(source: string): T {
  return parse(source) as T
}

export function stringifyYaml(value: unknown): string {
  return stringify(value)
}
