# UnrpycPure

UnrpycPure is a pure JavaScript Ren'Py `.rpyc` decompiler.

Unlike some similar tools, this package does not run the Python version in the browser.

If you want to preview RPA online, go [RPA-Explorer](https://github.com/asakuraminani/RPA-Explorer).

## Features

- Decompile a single `.rpyc` file or an entire directory
- Generate translation templates in Ren'Py `.rpy` format or JSON.

## Install

```bash
npm install unrpyc-pure
```

## CLI Usage

Decompile one file or a directory of `.rpyc` files:

```bash
npx unrpyc <input> <output>
npx unrpyc example.rpyc example.rpy # single file
npx unrpyc /path/in/ /path/out/ # directory
```

Generate Ren'Py translation templates:

```bash
npx unrpyc --gen-translate text <language> <input> <output>
npx unrpyc --gen-translate text chinese example.rpyc example.rpy # single file
npx unrpyc --gen-translate text chinese /path/in/ /path/out/ # directory
```

Generate translation JSON:

```bash
npx unrpyc --gen-translate json <input> <output>
npx unrpyc --gen-translate json example.rpyc example.json # single file
npx unrpyc --gen-translate json /path/in/ /path/out/ # directory
```

## Node.js Usage

```js
import {
  decompileRpyc,
  genTranslate
} from 'unrpyc-pure';

await decompileRpyc('/path/in/', '/path/out/');
await genTranslate('/path/in/', '/path/out/', 'text', { language: 'chinese' });
await genTranslate('/path/in/', '/path/out/', 'json');
```


## Browser usage

When bundled for the browser, `unrpyc-pure` resolves to `browser.js` and `decompileRpyc(input, options?)` remains an in-memory API that accepts binary input and returns script text:

- `decompileRpyc(input, options?)`
- `genTranslate(input, type, options?)`

Browser inputs may be:

- `Uint8Array`
- `ArrayBuffer`
- `ArrayBufferView`

Examples:

```js
import { decompileRpyc, genTranslate } from 'unrpyc-pure';

// Returns Ren'Py script text
const scriptText = decompileRpyc(rpycBuffer);
// Returns Ren'Py translation template text
const translationText = genTranslate(rpycBuffer, 'text', {language: 'chinese'});
// Returns JSON string
const translationJson = genTranslate(rpycBuffer, 'json');
```


### Translation Template vs. JSON String

```python
# game/Week1.rpy:40
translate chinese june01start_5652147a:

    # woman "My name is... Rebecca."
    woman "My name is... Rebecca."

translate chinese strings:

    # game/Week1.rpy:578
    old "Yes, sir!"
    new "Yes, sir!"
```


```json
[
  {
    "type": "dialogue",
    "line": 40,
    "text": "My name is... Rebecca.",
    "identifier": "june01start_5652147a",
    "digest": "5652147a",
    "label": "june01start",
    "who": "woman"
  },
  {
    "type": "string",
    "line": 578,
    "text": "Yes, sir!",
    "label": "w1RoseInterview"
  }
]
```

## Special thanks

Special thanks to the original [Python unrpyc project](https://github.com/CensoredUsername/unrpyc).

This JavaScript version borrows heavily from the ideas, structure, and behavior of the Python implementation.
