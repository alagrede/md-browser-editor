// The colors of the highlighted code. Every value is a CSS variable, so the
// palette follows the page's scheme instead of being decided here — the same
// rule the rest of the app follows.
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

const style = HighlightStyle.define([
    { tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment], color: 'var(--syn-comment)', fontStyle: 'italic' },
    { tag: [tags.keyword, tags.controlKeyword, tags.moduleKeyword, tags.operatorKeyword], color: 'var(--syn-keyword)' },
    { tag: [tags.string, tags.special(tags.string), tags.regexp], color: 'var(--syn-string)' },
    { tag: [tags.number, tags.bool, tags.null, tags.atom], color: 'var(--syn-number)' },
    { tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.labelName], color: 'var(--syn-function)' },
    { tag: [tags.propertyName, tags.attributeName, tags.definition(tags.propertyName)], color: 'var(--syn-property)' },
    { tag: [tags.typeName, tags.className, tags.namespace, tags.definition(tags.typeName)], color: 'var(--syn-type)' },
    { tag: [tags.operator, tags.punctuation, tags.separator, tags.bracket], color: 'var(--syn-punctuation)' },
    { tag: [tags.variableName, tags.definition(tags.variableName)], color: 'var(--syn-variable)' },
    // tags.tagName only: tags.heading would repaint the document's own
    // headings, which take their look from the live-preview classes.
    { tag: tags.tagName, color: 'var(--syn-keyword)' },
    { tag: tags.invalid, color: 'var(--error)' },
    { tag: tags.inserted, color: 'var(--syn-string)' },
    { tag: tags.deleted, color: 'var(--error)' },
]);

export const codeHighlighting = syntaxHighlighting(style);
