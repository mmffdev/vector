import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'Vector API Reference',
  tagline: 'REST API, database schema, and MCP tools — MMFFDev Vector',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  url: 'http://localhost:8083',
  baseUrl: '/',

  onBrokenLinks: 'throw',
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          routeBasePath: '/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'Vector API Reference',
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'apiSidebar',
          position: 'left',
          label: 'Docs',
        },
      ],
    },
    footer: {
      style: 'dark',
      copyright: 'MMFFDev Vector — Internal API Reference',
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'json', 'go', 'sql'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
