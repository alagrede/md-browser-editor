// Syntax highlighting inside fenced code blocks.
//
// A curated list rather than @codemirror/language-data: that one resolves every
// language known to CodeMirror, which in a bundle means shipping all of them.
// These are the ones documentation actually contains, and an unknown info
// string is not an error — the block simply stays plain.
import { LanguageDescription, LanguageSupport, StreamLanguage } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';

// A legacy mode is a StreamLanguage, but LanguageDescription.load has to
// resolve to a LanguageSupport — handing back the bare language made
// lang-markdown read `.parser` off undefined, and the whole editor threw.
const streamLanguage = (loader, key) =>
    loader().then(module => new LanguageSupport(StreamLanguage.define(module[key])));

const describe = (name, alias, load) => LanguageDescription.of({ name, alias, load });

export const codeLanguages = [
    describe('JavaScript', ['js', 'jsx', 'mjs', 'cjs', 'node'], async () => javascript({ jsx: true })),
    describe('TypeScript', ['ts', 'tsx'], async () => javascript({ jsx: true, typescript: true })),
    describe('JSON', ['json', 'jsonc'], async () => json()),
    describe('CSS', ['css'], async () => css()),
    describe('HTML', ['html', 'htm', 'xhtml'], async () => html()),
    describe('Shell', ['sh', 'bash', 'zsh', 'shell', 'console'], () =>
        streamLanguage(() => import('@codemirror/legacy-modes/mode/shell'), 'shell')
    ),
    describe('YAML', ['yaml', 'yml'], () =>
        streamLanguage(() => import('@codemirror/legacy-modes/mode/yaml'), 'yaml')
    ),
    describe('Python', ['python', 'py'], () =>
        streamLanguage(() => import('@codemirror/legacy-modes/mode/python'), 'python')
    ),
    describe('SQL', ['sql'], () =>
        streamLanguage(() => import('@codemirror/legacy-modes/mode/sql'), 'standardSQL')
    ),
    describe('XML', ['xml', 'svg'], () =>
        streamLanguage(() => import('@codemirror/legacy-modes/mode/xml'), 'xml')
    ),
    describe('Diff', ['diff', 'patch'], () =>
        streamLanguage(() => import('@codemirror/legacy-modes/mode/diff'), 'diff')
    ),
    describe('Dockerfile', ['dockerfile', 'docker'], () =>
        streamLanguage(() => import('@codemirror/legacy-modes/mode/dockerfile'), 'dockerFile')
    ),
    describe('TOML', ['toml'], () =>
        streamLanguage(() => import('@codemirror/legacy-modes/mode/toml'), 'toml')
    ),
];
