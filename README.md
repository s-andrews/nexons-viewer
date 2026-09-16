# Nexons read viewer

A web-based genome data viewer for comparing local BAM alignments against transcript models from a GTF or prebuilt exon-index JSON file.

The hosted copy is available at:

https://nexons-viewer.netlify.app/

## Prerequisites

- Node.js 18 or newer
- npm, which is installed with Node.js

This is a Vite + React + TypeScript application. All genome files are selected from your browser and processed locally; you do not need a backend server to run the viewer.

## Install

From the project directory:

```bash
npm install
```

If you are setting up from a clean checkout and want npm to install exactly the versions in `package-lock.json`, use:

```bash
npm ci
```

## Run Locally

Start the development server:

```bash
npm run dev
```

Vite will print a local URL, usually:

```text
http://localhost:5173/
```

Open that URL in a browser.

## Use The Viewer

1. Select a GTF file, or select a JSON exon-index file if you already have one.
2. If loading a GTF, choose the maximum transcript support level with the **Max TSL** control before selecting the file. Use **All** to avoid filtering by TSL.
3. Select BAM files together with their matching BAI index files. You can select multiple BAM/BAI pairs at once.
4. Open genes with the `+` gene tab control, then choose 1, 2, or 4 panels to compare loaded BAMs.

BAI filenames must match one of these patterns for each BAM:

- `sample.bam.bai`
- `sample.bai`

The viewer reads BAM headers, BAI indexes, and queried BAM regions in the browser. Large GTF files are parsed in a web worker so the page remains responsive.

## Build

Create a production build:

```bash
npm run build
```

The compiled files are written to `dist/`.

Preview the production build locally:

```bash
npm run preview
```

Vite will print the preview URL.

## Lint

Run the configured Oxlint checks:

```bash
npm run lint
```

## Troubleshooting

If `node` or `npm` is not recognized after installing Node.js, close and reopen your terminal so it picks up the updated PATH.

If `npm install` or `npm ci` fails with `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`, configure npm or Node.js to trust your local/corporate certificate authority, then rerun the install command.

## Available Scripts

- `npm run dev` - start the Vite development server with hot reload
- `npm run build` - type-check with TypeScript and build the production bundle
- `npm run preview` - serve the production build locally
- `npm run lint` - run Oxlint
