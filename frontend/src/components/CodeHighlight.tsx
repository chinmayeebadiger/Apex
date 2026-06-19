'use client';

import React, { useMemo } from 'react';

interface CodeHighlightProps {
  code: string;
}

export function CodeHighlight({ code }: CodeHighlightProps) {
  const highlightedHtml = useMemo(() => {
    if (!code) return '';

    // Regex matching different parts of TypeScript/JS code
    const rules = [
      // Comments
      { type: 'comment', regex: /(\/\/.*|\/\*[\s\S]*?\*\/)/g },
      // Strings (double quotes, single quotes, backticks)
      { type: 'string', regex: /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/g },
      // Keywords
      { 
        type: 'keyword', 
        regex: /\b(import|export|from|const|let|var|class|constructor|new|return|extends|super|async|await|try|catch|throw|if|else|interface|type|default|public|private|protected|static|readonly|implements|as|of|in|for|while)\b/g 
      },
      // Built-ins and values
      { type: 'builtin', regex: /\b(string|number|boolean|any|void|unknown|never|undefined|null|true|false|this)\b/g },
      // Numbers
      { type: 'number', regex: /\b(\d+)\b/g },
      // Custom capitalized types/classes
      { type: 'type', regex: /\b([A-Z][a-zA-Z0-9_]*)\b/g },
      // Functions/methods (word followed by open parenthesis)
      { type: 'method', regex: /\b([a-zA-Z_][a-zA-Z0-9_]*)(?=\()/g }
    ];

    // We can tokenize using a sequential replacement strategy
    // First, escape HTML entities
    let escaped = code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // To prevent regex overlapping, we find all tokens and sort them by position
    interface Token {
      start: number;
      end: number;
      type: string;
      value: string;
    }

    const tokens: Token[] = [];

    // Run each rule to collect matches
    rules.forEach((rule) => {
      let match;
      // We must recreate the regex with 'g' to reset lastIndex
      const regex = new RegExp(rule.regex.source, 'g');
      
      while ((match = regex.exec(escaped)) !== null) {
        tokens.push({
          start: match.index,
          end: regex.lastIndex,
          type: rule.type,
          value: match[0],
        });
      }
    });

    // Sort tokens by start position (ascending), and then by length (descending) to resolve conflicts
    tokens.sort((a, b) => {
      if (a.start !== b.start) {
        return a.start - b.start;
      }
      return (b.end - b.start) - (a.end - a.start);
    });

    // Filter out overlapping tokens (first one wins)
    const activeTokens: Token[] = [];
    let lastIndex = 0;
    
    for (const token of tokens) {
      if (token.start >= lastIndex) {
        activeTokens.push(token);
        lastIndex = token.end;
      }
    }

    // Reconstruct the string with HTML tags
    let result = '';
    let currentIdx = 0;

    // Class mappings for tokens (Tailwind CSS style classes)
    const tokenClasses: Record<string, string> = {
      comment: 'text-zinc-500 italic',
      string: 'text-emerald-400 font-mono',
      keyword: 'text-violet-400 font-semibold',
      builtin: 'text-amber-400 font-semibold',
      number: 'text-orange-400',
      type: 'text-sky-400 font-semibold',
      method: 'text-teal-300',
    };

    activeTokens.forEach((token) => {
      // Add text before the token
      if (token.start > currentIdx) {
        result += escaped.substring(currentIdx, token.start);
      }
      // Add the token wrapped in a span with style
      const cls = tokenClasses[token.type] || '';
      result += `<span class="${cls}">${token.value}</span>`;
      currentIdx = token.end;
    });

    // Add any remaining text
    if (currentIdx < escaped.length) {
      result += escaped.substring(currentIdx);
    }

    return result;
  }, [code]);

  return (
    <pre className="overflow-x-auto text-sm leading-relaxed font-mono select-text py-2">
      <code 
        className="block px-4 whitespace-pre text-zinc-300"
        dangerouslySetInnerHTML={{ __html: highlightedHtml }} 
      />
    </pre>
  );
}
