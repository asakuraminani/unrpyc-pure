# UnrpycPure

UnrpycPure is a pure JavaScript Ren'Py toolkit for `.rpyc` decompilation, translation generation, and `.rpa` archive handling.

Unlike some similar tools, this package does not run the Python version in the browser.

If you want to preview RPA online, go [RPA-Explorer](https://github.com/asakuraminani/RPA-Explorer).

## Features

- Decompile a single `.rpyc` file or an entire directory
- Generate translation templates in Ren'Py `.rpy` format or JSON
- Unpack a single `.rpa` archive into a directory in Node.js
- Open an `.rpa` archive in the browser as a lazy index and read entries on demand

## Install

```bash
npm install unrpyc-pure
```

## CLI Usage

Decompile one file or a directory of `.rpyc` files:

```bash
npx unrpyc <input> [output]
npx unrpyc example.rpyc # writes example.rpy next to input
npx unrpyc example.rpyc example.rpy # single file
npx unrpyc /path/in/ # writes /path/in-decompiled/
npx unrpyc /path/in/ /path/out/ # writes /path/out/in/
```

Generate Ren'Py translation templates:

```bash
npx unrpyc --gen-translate text <language> <input> [output]
npx unrpyc --gen-translate text chinese example.rpyc # writes chinese/example.rpy next to input
npx unrpyc --gen-translate text chinese example.rpyc example.rpy # single file
npx unrpyc --gen-translate text chinese /path/in/ # writes /path/in/chinese/
npx unrpyc --gen-translate text chinese /path/in/ /path/out/ # writes /path/out/chinese/
```

Generate translation JSON:

```bash
npx unrpyc --gen-translate json <input> [output]
npx unrpyc --gen-translate json example.rpyc # writes translate-json/example.json next to input
npx unrpyc --gen-translate json /path/in/ # writes /path/in/translate-json/
npx unrpyc --gen-translate json /path/in/ /path/out/ # writes /path/out/translate-json/
```
Unpack a single RPA archive:

```bash
npx unrpyc --unpack-rpa archive.rpa out # unpack archive to out/archive/
```

## Node.js Usage

```js
import {
  decompileRpyc,
  genTranslate,
  unpackRpa,
  openRpa
} from 'unrpyc-pure';

await decompileRpyc('/path/in/', '/path/out/');
await genTranslate('/path/in/', '/path/out/', 'text', { language: 'chinese' });
await genTranslate('/path/in/', '/path/out/', 'json');
await unpackRpa('archive.rpa', '/path/out/');

const archive = await openRpa(rpaBuffer);
const script = await archive.decompile('game/script.rpyc');
```

## Browser

```js
import { openRpa } from 'unrpyc-pure';

const archive = await openRpa(rpaFile);
const entry = archive.files.get('game/script.rpyc');
const bytes = await archive.read(entry);
const script = await archive.decompile('game/script.rpyc');
const optionsText = await archive.readText('game/options.rpy');
```

## Documentation

Full API documentation is in [docs/API.md](docs/API.md).

## Special thanks

Special thanks to the original [Python unrpyc project](https://github.com/CensoredUsername/unrpyc).

This JavaScript version borrows heavily from the ideas, structure, and behavior of the Python implementation.
