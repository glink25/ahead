import type { Plugin } from 'vite'

export function injectHeadHtml(html: string, headHtml?: string): string {
  if (!headHtml) return html

  const closingHead = '</head>'
  const position = html.indexOf(closingHead)
  if (position === -1)
    throw new Error('Configured head HTML could not be injected: closing head tag not found')

  return html.slice(0, position) + headHtml + html.slice(position)
}

export function headHtmlPlugin(headHtml?: string): Plugin {
  return {
    name: 'ahead-head-html',
    apply: 'build',
    transformIndexHtml(html) {
      return injectHeadHtml(html, headHtml)
    },
  }
}
