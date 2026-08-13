export interface FoldingRangeLike {
    start: number;
    end: number;
}

const accessSpecifierPattern: RegExp = /^\s*(public|protected|private)\s*:\s*$/;

function stripLineForFolding(line: string, inBlockComment: boolean): { text: string; inBlockComment: boolean; } {
    let result = '';
    let index = 0;
    let inString: '"' | '\'' | undefined;

    while (index < line.length) {
        const character = line[index];
        const nextCharacter = line[index + 1];

        if (inBlockComment) {
            if (character === '*' && nextCharacter === '/') {
                inBlockComment = false;
                index += 2;
                continue;
            }

            index++;
            continue;
        }

        if (inString !== undefined) {
            if (character === '\\') {
                index += 2;
                continue;
            }

            if (character === inString) {
                inString = undefined;
            }

            index++;
            continue;
        }

        if (character === '/' && nextCharacter === '/') {
            break;
        }

        if (character === '/' && nextCharacter === '*') {
            inBlockComment = true;
            index += 2;
            continue;
        }

        if (character === '"' || character === '\'') {
            inString = character;
            index++;
            continue;
        }

        result += character;
        index++;
    }

    return { text: result, inBlockComment };
}

function countCharacter(line: string, character: string): number {
    return (line.match(new RegExp(`\\${character}`, 'g')) ?? []).length;
}

function addFoldingRange(ranges: FoldingRangeLike[], startLine: number, endLine: number): void {
    if (endLine > startLine) {
        ranges.push({ start: startLine, end: endLine });
    }
}

export function collectAccessSpecifierFoldingRanges(text: string): FoldingRangeLike[] {
    const ranges: FoldingRangeLike[] = [];
    const activeSectionsByDepth: Map<number, number> = new Map<number, number>();
    const classBodyDepths: number[] = [];
    const lines: string[] = text.split(/\r?\n/);

    let inBlockComment = false;
    let braceDepth = 0;
    let pendingClassDeclaration = false;

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const strippedLine = stripLineForFolding(lines[lineIndex], inBlockComment);
        inBlockComment = strippedLine.inBlockComment;

        const lineText = strippedLine.text;
        const currentDepth = braceDepth;
        const currentClassDepth = classBodyDepths[classBodyDepths.length - 1];

        if (currentClassDepth === currentDepth && accessSpecifierPattern.test(lineText)) {
            const activeSectionStart = activeSectionsByDepth.get(currentDepth);
            if (activeSectionStart !== undefined) {
                addFoldingRange(ranges, activeSectionStart, lineIndex - 1);
            }

            activeSectionsByDepth.set(currentDepth, lineIndex);
        }

        if (/^\s*(class|struct|union)\b/.test(lineText)) {
            pendingClassDeclaration = true;
        }

        const openingBraces = countCharacter(lineText, '{');
        const closingBraces = countCharacter(lineText, '}');

        if (pendingClassDeclaration) {
            if (openingBraces > 0) {
                const classBodyDepth = currentDepth + openingBraces - closingBraces;
                if (classBodyDepth > currentDepth) {
                    classBodyDepths.push(classBodyDepth);
                }
                pendingClassDeclaration = false;
            } else if (lineText.includes(';')) {
                pendingClassDeclaration = false;
            }
        }

        braceDepth = currentDepth + openingBraces - closingBraces;

        while (classBodyDepths.length > 0 && classBodyDepths[classBodyDepths.length - 1] > braceDepth) {
            const endedClassDepth = classBodyDepths.pop();
            if (endedClassDepth === undefined) {
                break;
            }

            const activeSectionStart = activeSectionsByDepth.get(endedClassDepth);
            if (activeSectionStart !== undefined) {
                addFoldingRange(ranges, activeSectionStart, lineIndex - 1);
                activeSectionsByDepth.delete(endedClassDepth);
            }
        }
    }

    const lastLine = lines.length - 1;
    activeSectionsByDepth.forEach((startLine: number) => addFoldingRange(ranges, startLine, lastLine));

    return ranges;
}