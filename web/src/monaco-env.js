// Configuration des workers Monaco pour Vite.
// Doit être importé AVANT toute utilisation de monaco-editor.
// On importe le coeur de l'éditeur + uniquement les langages utiles
// (au lieu du barrel `monaco-editor` complet qui embarque ~90 langages),
// ce qui réduit fortement la taille du bundle.
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'

// Fonctionnalités de base de l'éditeur (recherche, contextmenu, etc.)
import 'monaco-editor/esm/vs/editor/editor.all.js'

// Langages "riches" (workers : diagnostics, complétion…)
import 'monaco-editor/esm/vs/language/json/monaco.contribution'
import 'monaco-editor/esm/vs/language/css/monaco.contribution'
import 'monaco-editor/esm/vs/language/html/monaco.contribution'
import 'monaco-editor/esm/vs/language/typescript/monaco.contribution'

// Coloration syntaxique "basique" pour les autres langages utilisés
import 'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution'
import 'monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution'
import 'monaco-editor/esm/vs/basic-languages/php/php.contribution'
import 'monaco-editor/esm/vs/basic-languages/python/python.contribution'
import 'monaco-editor/esm/vs/basic-languages/shell/shell.contribution'
import 'monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution'
import 'monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution'
import 'monaco-editor/esm/vs/basic-languages/xml/xml.contribution'
import 'monaco-editor/esm/vs/basic-languages/sql/sql.contribution'
import 'monaco-editor/esm/vs/basic-languages/go/go.contribution'
import 'monaco-editor/esm/vs/basic-languages/rust/rust.contribution'
import 'monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution'
import 'monaco-editor/esm/vs/basic-languages/java/java.contribution'
import 'monaco-editor/esm/vs/basic-languages/ruby/ruby.contribution'
import 'monaco-editor/esm/vs/basic-languages/ini/ini.contribution'

import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

self.MonacoEnvironment = {
  getWorker (_workerId, label) {
    if (label === 'json') return new jsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker()
    if (label === 'typescript' || label === 'javascript') return new tsWorker()
    return new editorWorker()
  }
}

// Devine le langage Monaco depuis l'extension du fichier.
export function langFor (name) {
  const x = (name.split('.').pop() || '').toLowerCase()
  const map = {
    js: 'javascript', mjs: 'javascript', cjs: 'javascript',
    ts: 'typescript', tsx: 'typescript', jsx: 'javascript',
    json: 'json', html: 'html', htm: 'html', vue: 'html',
    css: 'css', scss: 'scss', less: 'less',
    php: 'php', py: 'python', sh: 'shell', bash: 'shell',
    md: 'markdown', markdown: 'markdown',
    yml: 'yaml', yaml: 'yaml',
    xml: 'xml', sql: 'sql', go: 'go', rs: 'rust',
    c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cc: 'cpp',
    java: 'java', rb: 'ruby', conf: 'ini', ini: 'ini',
    txt: 'plaintext'
  }
  return map[x] || 'plaintext'
}

export { monaco }
