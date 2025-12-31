/**
 * Parser for $`variable` and &`function` syntax in prompts.
 */

export interface ParsedPrompt {
  variables: string[];
  functions: string[];
}

/**
 * Parse a prompt to extract variable and function references.
 * 
 * - $`variableName` references a kernel variable
 * - &`functionName` makes a function available as an AI tool
 */
export function parsePrompt(text: string): ParsedPrompt {
  // Match $`variableName` (word characters inside backticks after $)
  const variablePattern = /\$`([a-zA-Z_][a-zA-Z0-9_]*)`/g;
  
  // Match &`functionName` (word characters inside backticks after &)
  const functionPattern = /&`([a-zA-Z_][a-zA-Z0-9_]*)`/g;

  const variables: string[] = [];
  const functions: string[] = [];

  let match;

  // Find all variable references
  while ((match = variablePattern.exec(text)) !== null) {
    const varName = match[1];
    if (!variables.includes(varName)) {
      variables.push(varName);
    }
  }

  // Find all function references
  while ((match = functionPattern.exec(text)) !== null) {
    const funcName = match[1];
    if (!functions.includes(funcName)) {
      functions.push(funcName);
    }
  }

  return {
    variables,
    functions
  };
}

/**
 * Replace variable references in prompt with their values.
 * Uses a replacer function to safely handle $ and other special chars in values.
 */
export function substituteVariables(
  text: string,
  variableValues: Record<string, string>
): string {
  let result = text;
  
  for (const [name, value] of Object.entries(variableValues)) {
    const pattern = new RegExp(`\\$\`${name}\``, 'g');
    // Use replacer function to avoid interpreting $& etc. in value
    result = result.replace(pattern, () => value);
  }
  
  return result;
}

/**
 * Remove function references from the prompt text.
 * (They're used for tool definitions, not prompt content)
 * Also normalizes whitespace to avoid double spaces.
 */
export function removeFunctionReferences(text: string): string {
  return text
    .replace(/&`([a-zA-Z_][a-zA-Z0-9_]*)`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Get a cleaned prompt with variables substituted and function refs removed.
 */
export function processPrompt(
  text: string,
  variableValues: Record<string, string>
): string {
  let result = substituteVariables(text, variableValues);
  result = removeFunctionReferences(result);
  return result.trim();
}
