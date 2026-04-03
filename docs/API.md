# API Documentation

## CLI

### Decompile `.rpyc`

```bash
unrpyc <input> [output]
```

- Single `.rpyc` input with no output → sibling `<file>.rpy`
- Directory input with no output → sibling `<input>-decompiled/` directory
- Directory input with explicit output → `<output>/<input-name>/`

### Generate translation template text

```bash
unrpyc --gen-translate text <language> <input> [output]
```

- Single `.rpyc` input with no output → sibling `<language>/<file>.rpy`
- Directory input with no output → `<input>/<language>/`
- Directory input with explicit output → `<output>/<input-name>/`

### Generate translation JSON

```bash
unrpyc --gen-translate json <input> [output]
```

- Single `.rpyc` input with no output → sibling `translate-json/<file>.json`
- Directory input with no output → `<input>/translate-json/`
- Directory input with explicit output → `<output>/<input-name>/`

### Unpack `.rpa`

```bash
unrpyc --unpack-rpa <input.rpa> <output-dir>
```

- Input must be a single `.rpa` file
- Output argument is the parent directory
- `archive.rpa` unpacked to `out` writes into `out/archive/`

---

## Node.js API

Import from the package root:

```js
import {
  decompileRpyc,
  genTranslate,
  unpackRpa,
  openRpa,
  parseRpaFile,
  extractRpaEntry,
  main,
  parseArgs,
  validateCliOptions
} from 'unrpyc-pure';
```

### `decompileRpyc(inputPath, outputPath, options?)`

Decompile a single `.rpyc` file or a directory tree.

```js
await decompileRpyc('/path/in/', '/path/out/');
```

### `genTranslate(inputPath, outputPath, type, options?)`

Generate translation output.

- `type: 'text'` requires `options.language`
- `type: 'json'` writes JSON output

```js
await genTranslate('/path/in/', '/path/out/', 'text', { language: 'chinese' });
await genTranslate('/path/in/', '/path/out/', 'json');
```

### `unpackRpa(inputPath, outputDir, options?)`

Unpack a single `.rpa` file to a directory on disk.

```js
await unpackRpa('archive.rpa', '/path/out/');
```

Result shape:

```js
{
  mode: 'unpack-rpa',
  inputPath,
  outputPath,
  entryCount,
  processedEntries,
  writtenFiles,
  errors
}
```

### `openRpa(source, options?)`

Open an `.rpa` archive as a lazy in-memory index.

- Suitable for browser-style usage and Node in-memory workflows
- Does not write to disk

```js
const archive = await openRpa(rpaBuffer);
const script = await archive.decompile('game/script.rpyc');
```

### `parseRpaFile(source, options?)`

Low-level API that parses an RPA archive index.

Input supports:
- `File`
- `Blob`
- `Uint8Array`
- `ArrayBuffer`
- `ArrayBufferView`

Returns:

```js
{
  entries,
  key,
  version,
  indexOffset,
  header
}
```

### `extractRpaEntry(source, entry)`

Low-level API that reads a single archive member as `Uint8Array`.

---

## Browser API

When bundled for the browser, the package resolves to `src/browser.js`.

Import:

```js
import {
  decompileRpyc,
  genTranslate,
  openRpa,
  parseRpaFile,
  extractRpaEntry
} from 'unrpyc-pure';
```

### `decompileRpyc(input, options?)`

In-memory `.rpyc` decompile.

Accepted input:
- `Uint8Array`
- `ArrayBuffer`
- `ArrayBufferView`

Returns decompiled Ren'Py script text.

### `genTranslate(input, type, options?)`

In-memory translation generation.

- `type: 'text'` → translation template text
- `type: 'json'` → JSON string

### `openRpa(source, options?)`

Recommended high-level browser RPA API.

Accepted input:
- `File`
- `Blob`
- `Uint8Array`
- `ArrayBuffer`

Returns an archive object:

```js
{
  entries,
  files,
  metadata,
  read,
  readText,
  decompile,
  translate
}
```

#### `archive.entries`

Flat array of archive entries.

#### `archive.files`

`Map<string, entry>` keyed by archive path.

```js
const entry = archive.files.get('game/script.rpyc');
```

#### `archive.metadata`

```js
{
  key,
  version,
  indexOffset,
  header
}
```

#### `archive.read(pathOrEntry)`

Read a single file as `Uint8Array` on demand.

```js
const bytes = await archive.read('game/script.rpyc');
```

#### `archive.readText(pathOrEntry, encoding?)`

Read a single file as text.

```js
const text = await archive.readText('game/options.rpy');
```

#### `archive.decompile(pathOrEntry, options?)`

Read one `.rpyc` file from the archive and run the browser decompiler.

```js
const script = await archive.decompile('game/script.rpyc');
```

#### `archive.translate(pathOrEntry, type, options?)`

Read one `.rpyc` file from the archive and run the browser translation generator.

```js
const json = await archive.translate('game/script.rpyc', 'json');
```

---

## Low-level vs high-level RPA APIs

Use these when:

- `openRpa(...)`
  - Recommended for most application code
  - Gives you a lazy index plus convenient helpers

- `parseRpaFile(...)` + `extractRpaEntry(...)`
  - Use when you want full low-level control
  - Good for custom archive browsers or specialized processing flows

---

## Notes

- Browser-side RPA handling uses a lazy index model
- `archive.files` is an index, not a preloaded map of all file bytes
- File bytes are extracted only when `read`, `readText`, `decompile`, or `translate` is called
