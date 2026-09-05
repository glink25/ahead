# Ahead / 盼头

English | [简体中文](README.zh-CN.md)

Know what there is to look forward to.

A game release, a trip, a concert, or a small personal plan—Ahead brings future events together so you can discover things you care about, subscribe to continuously updated feeds, save favorites, and organize your life in a timeline or calendar.

- **Discover and create**: Browse public events or add your own. When dates are uncertain, keep them as a month, quarter, or unknown date.
- **Your own perspective**: Subscriptions, favorites, and personal events form your profile. Keep multiple public or private profiles.
- **Open and portable**: Events use the open OEF protocol and live as YAML / JSON in GitHub repositories. The Market helps you discover content; source repositories hold the content itself.
- **Keep going offline**: After the first online cache completes, browse and edit offline. Sign in to sync local changes to your repositories.

## Write event feeds with AI

Give the following prompt to an AI that can read GitHub documentation, replacing the topic as needed:

> Following the Ahead protocol (https://github.com/glink25/ahead/blob/main/docs/protocol/README.md), write an ahead.yaml event feed for public holidays.

[Protocol and examples](docs/protocol/README.md) explain the format and link to the schemas. Validate generated content in Studio's YAML editor. To share a feed publicly, see the [Market guide](docs/market/README.md).

## Run locally

Use Node.js 22 and pnpm 9, matching the current CI environment:

```bash
pnpm install
cp apps/web/.env.example apps/web/.env
pnpm dev
```

See [Web development](apps/web/README.md) for configuration and deployment, and the [documentation index](docs/README.md) for other guides. These linked guides are currently in Chinese.

## Languages

The app supports English and Simplified Chinese. It follows browser language preferences by default and uses English when neither language matches. Choose a language or return to following the browser in **Settings → Display and privacy → Language**. Manual preferences stay in this browser.

Language packs load on demand. Once cached, a language can be used offline; switching to an uncached language requires a connection. Event content uses an existing translation when available and otherwise shows the original text.

This project README is maintained in English and Simplified Chinese only, independently of any future app languages.

## License

[MIT](LICENSE)
