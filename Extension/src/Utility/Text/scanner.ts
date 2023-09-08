/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { CharacterCodes, isBinaryDigit, isDigit, isHexDigit, isIdentifierPart, isIdentifierStart, isLineBreak, isWhiteSpaceSingleLine, sizeOf } from './characterCodes';

/* eslint-disable @typescript-eslint/no-non-null-assertion */

export enum MessageCategory {
    Warning,
    Error,
    Suggestion,
    Message
}

export interface Message {
    code: number;
    category: MessageCategory;
    text: string;
}

export const messages = {
    DigitExpected: { code: 1100, category: MessageCategory.Error, text: 'Digit expected (0-9)' },
    HexDigitExpected: { code: 1101, category: MessageCategory.Error, text: 'Hex Digit expected (0-F,0-f)' },
    BinaryDigitExpected: { code: 1102, category: MessageCategory.Error, text: 'Binary Digit expected (0,1)' },
    UnexpectedEndOfFile: { code: 1103, category: MessageCategory.Error, text: 'Unexpected end of file while searching for \'{0}\'' },
    InvalidEscapeSequence: { code: 1104, category: MessageCategory.Error, text: 'Invalid escape sequence' }
};

export function format(text: string, ...args: (string | number)[]): string {
    return text.replace(/{(\d+)}/g, (_match, index: string) => '' + args[+index] || '<ARGMISSING>');
}

export interface Token {
    /** the character offset within the document */
    readonly offset: number;

    /** the text of the current token (when appropriate) */
    text: string;

    /** the literal value  */
    stringValue?: string;

    /** the token kind */
    readonly kind: Kind;
}

// All conflict markers consist of the same character repeated seven times.  If it is
// a <<<<<<< or >>>>>>> marker then it is also followed by a space.
const mergeConflictMarkerLength = 7;

/**
 * Position in a text document expressed as zero-based line and character offset.
 * The offsets are based on a UTF-16 string representation. So a string of the form
 * `a𐐀b` the character offset of the character `a` is 0, the character offset of `𐐀`
 * is 1 and the character offset of b is 3 since `𐐀` is represented using two code
 * units in UTF-16.
 *
 * Positions are line end character agnostic. So you can not specify a position that
 * denotes `\r|\n` or `\n|` where `|` represents the character offset.
 */
export interface Position {
    /**
     * Line position in a document (zero-based).
     * If a line number is greater than the number of lines in a document, it defaults back to the number of lines in the document.
     * If a line number is negative, it defaults to 0.
     */
    line: number;
    /**
     * Character offset on a line in a document (zero-based). Assuming that the line is
     * represented as a string, the `character` value represents the gap between the
     * `character` and `character + 1`.
     *
     * If the character value is greater than the line length it defaults back to the
     * line length.
     * If a line number is negative, it defaults to 0.
     */
    column: number;
}

export enum Kind {
    Unknown,
    EndOfFile,

    SingleLineComment,
    MultiLineComment,
    SingleLineHashComment,
    MultiLineHashComment,
    NewLine,
    Whitespace,

    // We detect and provide better error recovery when we encounter a git merge marker.  This
    // allows us to edit files with git-conflict markers in them in a much more pleasant manner.
    ConflictMarker,

    // Literals
    NumericLiteral,
    StringLiteral,

    // Boolean Literals
    BooleanLiteral,

    TrueKeyword,
    FalseKeyword,

    // Punctuation
    OpenBrace,
    CloseBrace,
    OpenParen,
    CloseParen,
    OpenBracket,
    CloseBracket,
    Dot,
    Ellipsis,
    Semicolon,
    Comma,
    QuestionDot,
    LessThan,
    // eslint-disable-next-line @typescript-eslint/prefer-literal-enum-member
    OpenAngle = LessThan,
    LessThanSlash,
    GreaterThan,
    // eslint-disable-next-line @typescript-eslint/prefer-literal-enum-member
    CloseAngle = GreaterThan,
    LessThanEquals,
    GreaterThanEquals,
    EqualsEquals,
    ExclamationEquals,
    EqualsEqualsEquals,
    ExclamationEqualsEquals,
    EqualsArrow,
    Plus,
    Minus,
    Asterisk,
    AsteriskAsterisk,
    Slash,
    Percent,
    PlusPlus,
    MinusMinus,
    LessThanLessThan,
    GreaterThanGreaterThan,
    GreaterThanGreaterThanGreaterThan,
    Ampersand,
    Bar,
    Caret,
    Exclamation,
    Tilde,
    AmpersandAmpersand,
    BarBar,
    Question,
    Colon,
    At,
    QuestionQuestion,
    Dollar,
    Backslash,

    // Assignments
    Equals,
    PlusEquals,
    MinusEquals,
    AsteriskEquals,
    AsteriskAsteriskEquals,
    SlashEquals,
    PercentEquals,
    LessThanLessThanEquals,
    GreaterThanGreaterThanEquals,
    GreaterThanGreaterThanGreaterThanEquals,
    AmpersandEquals,
    BarEquals,
    BarBarEquals,
    AmpersandAmpersandEquals,
    QuestionQuestionEquals,
    CaretEquals,

    // Other Things
    CodeFence,

    // Identifiers
    Variable,
    Identifier,

    // Keywords
    KeywordsStart = 1000,
    ThisKeyword,
    AwaitKeyword,
    OnceKeyword,

    KeywordsEnd,
}

const keywords = new Map([

    ['this', Kind.ThisKeyword],
    ['await', Kind.AwaitKeyword],
    ['once', Kind.OnceKeyword],

    ['true', Kind.BooleanLiteral], // TrueKeyword
    ['false', Kind.BooleanLiteral] // FalseKeyword
]);

interface TokenLocation extends Position {
    offset: number;
}

/** This is a fairly generic scanner for making it easy to parse expressions and code blocks in a variety of formats
 *
 * (the supported tokens are derived from the TypeScript grammar)
 */
export class Scanner implements Token {
    #offset = 0;
    #line = 0;
    #column = 0;
    #map = new Array<TokenLocation>();

    #length: number;
    #text: string;

    #ch!: number;
    #chNext!: number;
    #chNextNext!: number;

    #chSz!: number;
    #chNextSz!: number;
    #chNextNextSz!: number;

    /** The assumed tab width. If this is set before scanning, it enables accurate Position tracking. */
    tabWidth = 2;

    // current token information

    /** the character offset within the document */
    offset!: number;

    /** the token kind */
    kind!: Kind;

    /** the text of the current token (when appropriate) */
    text!: string;

    /** the string value of current string literal token (unquoted, unescaped) */
    stringValue?: string;

    /** returns the Position (line/column) of the current token */
    get position(): Position {
        return this.positionFromOffset(this.offset);
    }

    constructor(text: string) {
        this.#text = text;
        this.#length = text.length;
        this.advance(0);
        this.markPosition();

        // let's hide these, then we can clone this nicely.
        Object.defineProperty(this, 'tabWidth', { enumerable: false });
    }

    private get eof() {
        return this.#offset > this.#length;
    }

    private advance(count?: number): number {
        let codeOrChar: number;
        let newOffset: number;
        let offsetAdvancedBy = 0;

        switch (count) {
            case undefined:
            case 1:
                offsetAdvancedBy = this.#chSz;
                this.#offset += this.#chSz;
                this.#ch = this.#chNext; this.#chSz = this.#chNextSz;
                this.#chNext = this.#chNextNext; this.#chNextSz = this.#chNextNextSz;

                newOffset = this.#offset + this.#chSz + this.#chNextSz;
                codeOrChar = this.#text.charCodeAt(newOffset);
                this.#chNextNext = (this.#chNextNextSz = sizeOf(codeOrChar)) === 1 ? codeOrChar : this.#text.codePointAt(newOffset)!;
                return offsetAdvancedBy;

            case 2:
                offsetAdvancedBy = this.#chSz + this.#chNextSz;
                this.#offset += this.#chSz + this.#chNextSz;
                this.#ch = this.#chNextNext; this.#chSz = this.#chNextNextSz;

                newOffset = this.#offset + this.#chSz;
                codeOrChar = this.#text.charCodeAt(newOffset);
                this.#chNext = (this.#chNextSz = sizeOf(codeOrChar)) === 1 ? codeOrChar : this.#text.codePointAt(newOffset)!;

                newOffset += this.#chNextSz;
                codeOrChar = this.#text.charCodeAt(newOffset);
                this.#chNextNext = (this.#chNextNextSz = sizeOf(codeOrChar)) === 1 ? codeOrChar : this.#text.codePointAt(newOffset)!;
                return offsetAdvancedBy;

            default:
            case 3:
                offsetAdvancedBy = this.#chSz + this.#chNextSz + this.#chNextNextSz;
                count -= 3;
                while (count) {
                    // skip over characters while we work.
                    offsetAdvancedBy += sizeOf(this.#text.charCodeAt(this.#offset + offsetAdvancedBy));
                }
                this.#offset += offsetAdvancedBy;

            // eslint-disable-next-line no-fallthrough
            case 0:
                newOffset = this.#offset;
                codeOrChar = this.#text.charCodeAt(newOffset);
                this.#ch = (this.#chSz = sizeOf(codeOrChar)) === 1 ? codeOrChar : this.#text.codePointAt(newOffset)!;

                newOffset += this.#chSz;
                codeOrChar = this.#text.charCodeAt(newOffset);
                this.#chNext = (this.#chNextSz = sizeOf(codeOrChar)) === 1 ? codeOrChar : this.#text.codePointAt(newOffset)!;

                newOffset += this.#chNextSz;
                codeOrChar = this.#text.charCodeAt(newOffset);
                this.#chNextNext = (this.#chNextNextSz = sizeOf(codeOrChar)) === 1 ? codeOrChar : this.#text.codePointAt(newOffset)!;
                return offsetAdvancedBy;
        }
    }

    private next(token: Kind, count = 1, value?: string) {
        const originalOffset = this.#offset;
        const offsetAdvancedBy = this.advance(count);
        this.text = value || this.#text.substr(originalOffset, offsetAdvancedBy);

        this.#column += count;
        return this.kind = token;
    }

    /** adds the current position to the token to the offset:position map */
    private markPosition() {
        this.#map.push({ offset: this.#offset, column: this.#column, line: this.#line });
    }

    /** updates the position and marks the location  */
    private newLine(count = 1) {
        this.text = this.#text.substr(this.#offset, count);
        this.advance(count);

        this.#line++;
        this.#column = 0;
        this.markPosition(); // make sure the map has the new location

        return this.kind = Kind.NewLine;
    }

    start() {
        if (this.offset === undefined) {
            this.scan();
        }
        return this;
    }

    /**
     * Identifies and returns the next token type in the document
     *
     * @returns the state of the scanner will have the properties `token`, `value`, `offset` pointing to the current token at the end of this call.
     *
     * @notes before this call, `#offset` is pointing to the next character to be evaluated.
     *
     */
    scan(): Kind {

        // this token starts at
        this.offset = this.#offset;
        this.stringValue = undefined;

        if (!(this.eof || isNaN(this.#ch))) {
            switch (this.#ch) {
                case CharacterCodes.carriageReturn:
                    return this.newLine(this.#chNext === CharacterCodes.lineFeed ? 2 : 1);

                case CharacterCodes.lineFeed:
                    return this.newLine();

                case CharacterCodes.tab:
                case CharacterCodes.verticalTab:
                case CharacterCodes.formFeed:
                case CharacterCodes.space:
                case CharacterCodes.nonBreakingSpace:
                case CharacterCodes.ogham:
                case CharacterCodes.enQuad:
                case CharacterCodes.emQuad:
                case CharacterCodes.enSpace:
                case CharacterCodes.emSpace:
                case CharacterCodes.threePerEmSpace:
                case CharacterCodes.fourPerEmSpace:
                case CharacterCodes.sixPerEmSpace:
                case CharacterCodes.figureSpace:
                case CharacterCodes.punctuationSpace:
                case CharacterCodes.thinSpace:
                case CharacterCodes.hairSpace:
                case CharacterCodes.zeroWidthSpace:
                case CharacterCodes.narrowNoBreakSpace:
                case CharacterCodes.mathematicalSpace:
                case CharacterCodes.ideographicSpace:
                case CharacterCodes.byteOrderMark:
                    return this.scanWhitespace();

                case CharacterCodes.$:
                    return isIdentifierPart(this.#chNext) ? this.scanVariable() : this.next(Kind.Dollar);

                case CharacterCodes.openParen:
                    return this.next(Kind.OpenParen);

                case CharacterCodes.closeParen:
                    return this.next(Kind.CloseParen);

                case CharacterCodes.comma:
                    return this.next(Kind.Comma);

                case CharacterCodes.colon:
                    return this.next(Kind.Colon);

                case CharacterCodes.semicolon:
                    return this.next(Kind.Semicolon);

                case CharacterCodes.openBracket:
                    return this.next(Kind.OpenBracket);

                case CharacterCodes.closeBracket:
                    return this.next(Kind.CloseBracket);

                case CharacterCodes.openBrace:
                    return this.next(Kind.OpenBrace);

                case CharacterCodes.closeBrace:
                    return this.next(Kind.CloseBrace);

                case CharacterCodes.tilde:
                    return this.next(Kind.Tilde);

                case CharacterCodes.at:
                    return this.next(Kind.At);

                case CharacterCodes.caret:
                    return this.#chNext === CharacterCodes.equals ? this.next(Kind.CaretEquals, 2) : this.next(Kind.Caret);

                case CharacterCodes.percent:
                    return this.#chNext === CharacterCodes.equals ? this.next(Kind.PercentEquals, 2) : this.next(Kind.Percent);

                case CharacterCodes.backslash:
                    return this.next(Kind.Backslash);

                case CharacterCodes.question:
                    return this.#chNext === CharacterCodes.dot && !isDigit(this.#chNextNext) ?
                        this.next(Kind.QuestionDot, 2) :
                        this.#chNext === CharacterCodes.question ?
                            this.#chNextNext === CharacterCodes.equals ?
                                this.next(Kind.QuestionQuestionEquals, 3) :
                                this.next(Kind.QuestionQuestion, 2) :
                            this.next(Kind.Question);

                case CharacterCodes.exclamation:
                    return this.#chNext === CharacterCodes.equals ?
                        this.#chNextNext === CharacterCodes.equals ?
                            this.next(Kind.ExclamationEqualsEquals, 3) :
                            this.next(Kind.ExclamationEquals, 2) :
                        this.next(Kind.Exclamation);

                case CharacterCodes.ampersand:
                    return this.#chNext === CharacterCodes.ampersand ?
                        this.#chNextNext === CharacterCodes.equals ?
                            this.next(Kind.AmpersandAmpersandEquals, 3) :
                            this.next(Kind.AmpersandAmpersand, 2) :
                        this.#chNext === CharacterCodes.equals ?
                            this.next(Kind.AmpersandEquals, 2) :
                            this.next(Kind.Ampersand);

                case CharacterCodes.asterisk:
                    return this.#chNext === CharacterCodes.asterisk ?
                        this.#chNextNext === CharacterCodes.equals ?
                            this.next(Kind.AsteriskAsteriskEquals, 3) :
                            this.next(Kind.AsteriskAsterisk, 2) :
                        this.#chNext === CharacterCodes.equals ?
                            this.next(Kind.AsteriskEquals, 2) :
                            this.next(Kind.Asterisk);

                case CharacterCodes.plus:
                    return this.#chNext === CharacterCodes.plus ?
                        this.next(Kind.PlusPlus, 2) :
                        this.#chNext === CharacterCodes.equals ?
                            this.next(Kind.PlusEquals, 2) :
                            this.next(Kind.Plus);

                case CharacterCodes.minus:
                    return this.#chNext === CharacterCodes.minus ?
                        this.next(Kind.MinusMinus, 2) :
                        this.#chNext === CharacterCodes.equals ?
                            this.next(Kind.MinusEquals, 2) :
                            this.next(Kind.Minus);

                case CharacterCodes.dot:
                    return isDigit(this.#chNext) ?
                        this.scanNumber() :
                        this.#chNext === CharacterCodes.dot && this.#chNextNext === CharacterCodes.dot ?
                            this.next(Kind.Ellipsis, 3) :
                            this.next(Kind.Dot);

                case CharacterCodes.slash:
                    return this.#chNext === CharacterCodes.slash ?
                        this.scanSingleLineComment() :
                        this.#chNext === CharacterCodes.asterisk ?
                            this.scanMultiLineComment() :

                            this.#chNext === CharacterCodes.equals ?
                                this.next(Kind.SlashEquals) :
                                this.next(Kind.Slash);

                case CharacterCodes.hash:
                    return this.scanHashComment();

                case CharacterCodes._0:
                    return this.#chNext === CharacterCodes.x || this.#chNext === CharacterCodes.X ?
                        this.scanHexNumber() :
                        this.#chNext === CharacterCodes.B || this.#chNext === CharacterCodes.B ?
                            this.scanBinaryNumber() :
                            this.scanNumber();

                case CharacterCodes._1:
                case CharacterCodes._2:
                case CharacterCodes._3:
                case CharacterCodes._4:
                case CharacterCodes._5:
                case CharacterCodes._6:
                case CharacterCodes._7:
                case CharacterCodes._8:
                case CharacterCodes._9:
                    return this.scanNumber();

                case CharacterCodes.lessThan:
                    return this.isConflictMarker() ?
                        this.next(Kind.ConflictMarker, mergeConflictMarkerLength) :
                        this.#chNext === CharacterCodes.hash ?
                            this.scanMultiLineHashComment() :
                            this.#chNext === CharacterCodes.lessThan ?
                                this.#chNextNext === CharacterCodes.equals ?
                                    this.next(Kind.LessThanLessThanEquals, 3) :
                                    this.next(Kind.LessThanLessThan, 2) :
                                this.#chNext === CharacterCodes.equals ?
                                    this.next(Kind.LessThanEquals, 2) :
                                    this.next(Kind.LessThan);

                case CharacterCodes.greaterThan:
                    return this.isConflictMarker() ?
                        this.next(Kind.ConflictMarker, mergeConflictMarkerLength) :
                        this.next(Kind.GreaterThan);

                case CharacterCodes.equals:
                    return this.isConflictMarker() ?
                        this.next(Kind.ConflictMarker, mergeConflictMarkerLength) :
                        this.#chNext === CharacterCodes.equals ?
                            this.#chNextNext === CharacterCodes.equals ?
                                this.next(Kind.EqualsEqualsEquals, 3) :
                                this.next(Kind.EqualsEquals, 2) :
                            this.#chNext === CharacterCodes.greaterThan ?
                                this.next(Kind.EqualsArrow, 2) :
                                this.next(Kind.Equals);

                case CharacterCodes.bar:
                    return this.isConflictMarker() ?
                        this.next(Kind.ConflictMarker, mergeConflictMarkerLength) :
                        this.#chNext === CharacterCodes.bar ?
                            this.#chNextNext === CharacterCodes.equals ?
                                this.next(Kind.BarBarEquals, 3) :
                                this.next(Kind.BarBar, 2) :
                            this.#chNext === CharacterCodes.equals ?
                                this.next(Kind.BarEquals, 2) :
                                this.next(Kind.Bar);

                case CharacterCodes.singleQuote:
                case CharacterCodes.doubleQuote:
                    return this.scanString();

                case CharacterCodes.backtick:
                    return this.#column === 0 && this.#chNext === CharacterCodes.backtick && this.#chNextNext === CharacterCodes.backtick ?
                        this.scanCodeFence() : this.scanString();

                default:
                    // FYI:
                    // Well-known characters that are currently not processed
                    //   # \
                    // will need to update the scanner if there is a need to recognize them
                    return isIdentifierStart(this.#ch) ? this.scanIdentifier() : this.next(Kind.Unknown);
            }
        }

        this.text = '';
        return this.kind = Kind.EndOfFile;
    }

    take(): Token {
        const result = { ...this };
        this.scan();
        return result;
    }

    *takeUntil(endToken: Kind, options?: { escape?: Kind[]; nestable?: [Kind, Kind][] }, yieldFinalClose?: boolean): Iterable<Token> {
        const nestable = options?.nestable || [];
        const escape = options?.escape || [];

        processing: do {
            switch (this.kind) {
                case endToken:
                    // if we're nested, we need to return the end token, because it's significant to the consumer
                    if (yieldFinalClose) {
                        yield this.take();
                        return;
                    }

                    // we're done here, lose the last token and get out
                    this.take();
                    return;

                case Kind.EndOfFile:
                    throw new Error('Unexpected end of tokens');
            }

            // check for escaped tokens
            if (escape.includes(this.kind)) {
                // pull through the escape token
                // and the next token
                yield this.take();
                yield this.take();
                continue;
            }

            // check for nested tokens
            for (const [open, close] of nestable as [Kind, Kind][]) {
                if (this.kind === open) {
                    yield this.take(); // yield the open token
                    yield* this.takeUntil(close, options, true);
                    continue processing;
                }
            }

            // yield the current token
            yield this.take();
        } while (true);
    }

    takeWhitespace() {
        while (!this.eof && this.isWhitespace) {
            this.scan();
        }
    }

    takeWhiteSpaceAndNewLines() {
        while (!this.eof && (this.isWhitespace || this.isNewLine)) {
            this.scan();
        }
    }

    get isWhitespace() {
        return this.kind === Kind.Whitespace;
    }

    get isNewLine() {
        return this.kind === Kind.NewLine;
    }

    get isEndOfFile() {
        return this.kind === Kind.EndOfFile;
    }

    get isComment() {
        switch (this.kind) {
            case Kind.SingleLineComment:
            case Kind.MultiLineComment:
            case Kind.SingleLineHashComment:
            case Kind.MultiLineHashComment:
                return true;
        }
        return false;
    }

    /**
     * When the current token is greaterThan, this will return any tokens with characters
     * after the greater than character. This has to be scanned separately because greater
     * than appears in positions where longer tokens are incorrect, e.g. `model x<y>=y;`.
     * The solution is to call rescanGreaterThan from the parser in contexts where longer
     * tokens starting with `>` are allowed (i.e. when parsing binary expressions).
     */
    rescanGreaterThan(): Kind {
        if (this.kind === Kind.GreaterThan) {
            return this.#ch === CharacterCodes.greaterThan ?
                this.#chNext === CharacterCodes.equals ?
                    this.next(Kind.GreaterThanGreaterThanEquals, 3) :
                    this.next(Kind.GreaterThanGreaterThan, 2) :
                this.#ch === CharacterCodes.equals ?
                    this.next(Kind.GreaterThanEquals, 2) :
                    this.next(Kind.GreaterThan);
        }
        return this.kind;
    }

    private isConflictMarker() {
        // Conflict markers must be at the start of a line.
        if (this.#offset === 0 || isLineBreak(this.#text.charCodeAt(this.#offset - 1))) {
            if ((this.#offset + mergeConflictMarkerLength) < this.#length) {
                for (let i = 0; i < mergeConflictMarkerLength; i++) {
                    if (this.#text.charCodeAt(this.#offset + i) !== this.#ch) {
                        return false;
                    }
                }
                return this.#ch === CharacterCodes.equals || this.#text.charCodeAt(this.#offset + mergeConflictMarkerLength) === CharacterCodes.space;
            }
        }

        return false;
    }

    private scanWhitespace(): Kind {
        // since whitespace are not always 1 character wide, we're going to mark the position before the whitespace.
        this.markPosition();

        do {
            // advance the position
            this.#column += this.widthOfCh;
            this.advance();
        } while (isWhiteSpaceSingleLine(this.#ch));

        // and after...
        this.markPosition();

        this.text = this.#text.substring(this.offset, this.#offset);
        return this.kind = Kind.Whitespace;
    }

    private scanDigits(): string {
        const start = this.#offset;
        while (isDigit(this.#ch)) {
            this.advance();
        }
        return this.#text.substring(start, this.#offset);
    }

    private scanNumber() {
        const start = this.#offset;

        const main = this.scanDigits();
        let decimal: string | undefined;
        let scientific: string | undefined;

        if (this.#ch === CharacterCodes.dot) {
            this.advance();
            decimal = this.scanDigits();
        }

        if (this.#ch === CharacterCodes.E || this.#ch === CharacterCodes.e) {
            this.assert(isDigit(this.#chNext), 'ParseError: Digit expected (0-9)');
            this.advance();
            scientific = this.scanDigits();
        }

        this.text = scientific ?
            decimal ?
                `${main}.${decimal}e${scientific}` :
                `${main}e${scientific}` :
            decimal ?
                `${main}.${decimal}` :
                main;

        // update the position
        this.#column += this.#offset - start;
        return this.kind = Kind.NumericLiteral;
    }

    private scanHexNumber() {
        this.assert(isHexDigit(this.#chNextNext), 'ParseError: Hex Digit expected (0-F,0-f)');
        this.advance(2);

        this.text = `0x${this.scanUntil((ch) => !isHexDigit(ch), 'Hex Digit')}`;
        return this.kind = Kind.NumericLiteral;
    }

    private scanBinaryNumber() {
        this.assert(isBinaryDigit(this.#chNextNext), 'ParseError: Binary Digit expected (0,1)');

        this.advance(2);

        this.text = `0b${this.scanUntil((ch) => !isBinaryDigit(ch), 'Binary Digit')}`;
        return this.kind = Kind.NumericLiteral;

    }

    private get widthOfCh() {
        return this.#ch === CharacterCodes.tab ? (this.#column % this.tabWidth || this.tabWidth) : 1;
    }

    private scanUntil(predicate: (char: number, charNext: number, charNextNext: number) => boolean, expectedClose?: string, consumeClose?: number) {
        const start = this.#offset;

        do {
            // advance the position
            if (isLineBreak(this.#ch)) {
                this.advance(this.#ch === CharacterCodes.carriageReturn && this.#chNext === CharacterCodes.lineFeed ? 2 : 1);
                this.#line++;
                this.#column = 0;
                this.markPosition(); // make sure the map has the new location
            } else {
                this.#column += this.widthOfCh;
                this.advance();
            }

            if (this.eof) {
                this.assert(!expectedClose, `Unexpected end of file while searching for '${expectedClose}'`);
                break;
            }

        } while (!predicate(this.#ch, this.#chNext, this.#chNextNext));

        if (consumeClose) {
            this.advance(consumeClose);
        }

        // and after...
        this.markPosition();

        return this.#text.substring(start, this.#offset);
    }

    private scanSingleLineComment() {
        this.text = this.scanUntil(isLineBreak);
        return this.kind = Kind.SingleLineComment;
    }
    private scanHashComment() {
        this.text = this.scanUntil(isLineBreak);
        return this.kind = Kind.SingleLineHashComment;
    }
    private scanMultiLineComment() {
        this.text = this.scanUntil((ch, chNext) => ch === CharacterCodes.asterisk && chNext === CharacterCodes.slash, '*/', 2);
        return this.kind = Kind.MultiLineComment;
    }
    private scanMultiLineHashComment() {
        this.text = this.scanUntil((ch, chNext) => ch === CharacterCodes.hash && chNext === CharacterCodes.greaterThan, '#>', 2);
        return this.kind = Kind.MultiLineHashComment;
    }

    private scanString() {
        const quote = this.#ch;
        const quoteLength = 1;
        const closing = String.fromCharCode(this.#ch);
        let escaped = false;
        let crlf = false;
        let isEscaping = false;

        const text = this.scanUntil((ch, chNext, _chNextNext) => {
            if (isEscaping) {
                isEscaping = false;
                return false;
            }

            if (ch === CharacterCodes.backslash) {
                isEscaping = escaped = true;
                return false;
            }

            if (ch === CharacterCodes.carriageReturn) {
                if (chNext === CharacterCodes.lineFeed) {
                    crlf = true;
                }
                return false;
            }

            return ch === quote;
        }, closing, quoteLength);

        // TODO: optimize to single pass over string, easier if we refactor some bookkeeping first.

        // strip quotes
        let value = text.substring(quoteLength, text.length - quoteLength);

        // Normalize CRLF to LF when interpreting value of multi-line string
        // literals. Matches JavaScript behavior and ensures program behavior does
        // not change due to line-ending conversion.
        if (crlf) {
            value = value.replace(/\r\n/g, '\n');
        }

        if (escaped) {
            value = this.unescapeString(value);
        }

        this.text = text;
        this.stringValue = value;
        return this.kind = Kind.StringLiteral;
    }

    private scanCodeFence() {
        // skip to the end of this line first
        const fenceStart = this.scanUntil((ch, chNext) => ch === CharacterCodes.lineFeed || (ch === CharacterCodes.carriageReturn && chNext === CharacterCodes.lineFeed));

        // end when the first column is triple backtick
        const code = this.scanUntil((ch, chNext, chNextNext) => this.#column === 0 && (ch === CharacterCodes.backtick && chNext === CharacterCodes.backtick && chNextNext === CharacterCodes.backtick));

        this.text = fenceStart + code;

        // code is just the inside contents
        this.stringValue = code.substring(0, code.length - 3);

        return this.kind = Kind.CodeFence;
    }

    private unescapeString(text: string) {
        let result = '';
        let start = 0;
        let pos = 0;
        const end = text.length;

        while (pos < end) {
            let ch = text.charCodeAt(pos);
            if (ch !== CharacterCodes.backslash) {
                pos++;
                continue;
            }

            result += text.substring(start, pos);
            pos++;
            ch = text.charCodeAt(pos);

            switch (ch) {
                case CharacterCodes.r:
                    result += '\r';
                    break;
                case CharacterCodes.n:
                    result += '\n';
                    break;
                case CharacterCodes.t:
                    result += '\t';
                    break;
                case CharacterCodes.singleQuote:
                    result += '\'';
                    break;
                case CharacterCodes.doubleQuote:
                    result += '"';
                    break;
                case CharacterCodes.backslash:
                    result += '\\';
                    break;
                case CharacterCodes.backtick:
                    result += '`';
                    break;
                default:
                    throw new ScannerError('Invalid escape sequence', this.position.line, this.position.column);
            }

            pos++;
            start = pos;
        }

        result += text.substring(start, pos);
        return result;
    }

    scanIdentifier() {
        this.text = this.scanUntil((ch) => !isIdentifierPart(ch));
        return this.kind = keywords.get(this.text) ?? Kind.Identifier;
    }

    scanVariable() {
        this.text = '$';
        this.text += this.scanUntil((ch) => !isIdentifierPart(ch));
        return this.kind = Kind.Variable;
    }

    /**
   * Returns the zero-based line/column from the given offset
   * (binary search through the token start locations)
   * @param offset the character position in the document
   */
    positionFromOffset(offset: number): Position {
        let position = { line: 0, column: 0, offset: 0 };

        if (offset < 0 || offset > this.#length) {
            return { line: position.line, column: position.column };
        }

        let first = 0; // left endpoint
        let last = this.#map.length - 1; // right endpoint
        let middle = Math.floor((first + last) / 2);

        while (first <= last) {
            middle = Math.floor((first + last) / 2);
            position = this.#map[middle];
            if (position.offset === offset) {
                return { line: position.line, column: position.column };
            }
            if (position.offset < offset) {
                first = middle + 1;
                continue;
            }
            last = middle - 1;
            position = this.#map[last];
        }
        return { line: position.line, column: position.column + (offset - position.offset) };
    }

    static * tokensFrom(text: string): Iterable<Token> {
        const scanner = new Scanner(text).start();
        while (!scanner.eof) {
            yield scanner.take();
        }
    }

    protected assert(assertion: boolean, message: string) {
        if (!assertion) {
            const p = this.position;
            throw new ScannerError(message, p.line, p.column);
        }
    }
}

export class ScannerError extends Error {
    constructor(message: string, public readonly line: number, public readonly column: number) {
        super(message);
    }
}
