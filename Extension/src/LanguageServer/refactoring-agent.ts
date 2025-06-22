import * as vscode from 'vscode';
import { clients } from './extension';
const path = require('path'); // Import Node.js path module
let suffixPrompt = " Output the changed code along with the rest of the entire input code snippet unchanged. Make sure entire output is formatted correctly";

interface ErrorDiagnostic {
	filePath: string;
	message: string;
	range: vscode.Range;
}

export interface ContextItem {
	updatedTextSpan?: string,
	filePath: string;
	startLine: number;
	closestRange?: vscode.Range;
}

async function parseChatResponse(chatResponse: vscode.LanguageModelChatResponse): Promise<string[]> {
	let accumulatedResponse = '';
	for await (const fragment of chatResponse.text) {
		accumulatedResponse += fragment;
	}

	const codeSnippets: string[] = [];

	// Use a regular expression to extract all code blocks
	const codeBlockRegex = /```(?:\w+)?\n([\s\S]*?)```/g;
	let match: RegExpExecArray | null;

	while ((match = codeBlockRegex.exec(accumulatedResponse)) !== null) {
		codeSnippets.push(match[1].trim());
	}

	if (codeSnippets.length === 0) {
		// vscode.window.showErrorMessage('No code blocks found in the response.');
	}

	return codeSnippets;
}

async function validateEdits(): Promise<boolean> {
	// execute CMake: Build command and check if build output is exit code 0 for pass or 1 for failure.
	try {
		// Rescan workspace to get rid of any stuck diagnostics left over.
		await vscode.commands.executeCommand('C_Cpp.RescanWorkspace');
		// await vscode.commands.executeCommand('cmake.clean');
		var buildResult = await vscode.commands.executeCommand('cmake.build');
		if (buildResult === 0) {
			return true;
		} else {
			return false;
		}
	} catch (error) {
		return false;
	}
}

// Purposely ignore if, else keywords since Copilot is not always accuraete with those responses.
const foldableKeyWords: { [keyWord: string]: boolean } = {
	"if": true,
	"else": true,
	"while": true,
	"for": true,
	"switch": true,
	"case": true,
	"do": true,
};

async function getClosestFoldingRange(editor: vscode.TextEditor, startLine: number): Promise<vscode.FoldingRange | undefined> {
	// await new Promise(resolve => setTimeout(resolve, 1000));
	const foldingRanges = await vscode.commands.executeCommand<vscode.FoldingRange[]>('vscode.executeFoldingRangeProvider', editor.document.uri);
	let closestRange: vscode.FoldingRange | undefined;
	if (foldingRanges && foldingRanges.length > 0) {
		const selectionStart = startLine;
		for (const range of foldingRanges) {
			if (
				range.start <= selectionStart &&
				range.end >= selectionStart &&
				(!closestRange ||
					(range.start >= closestRange.start && range.end <= closestRange.end))
			) {
				const start = editor.document.lineAt(range.start).range.start;
				const end = editor.document.lineAt(range.end).range.end;
				var snippetInputRange = new vscode.Range(start, end);
				var nearestRangeTextSpan = editor.document.getText(snippetInputRange);
				const startsWithKeyword = Object.keys(foldableKeyWords).some(keyword => nearestRangeTextSpan.trim().startsWith(keyword));
				// const startsWithBracket = nearestRangeTextSpan.trim().startsWith('{');
				// if (startsWithBracket) {
				// 	closestRange = range;
				// 	closestRange.start += 1; // Increment start by 1 if it starts with a bracket to avoid adding bracket into the snippet.
				// }
				if (!startsWithKeyword) {
					// Make sure to avoid foldableKeyWords since Copilot is not always accurate with those.
					closestRange = range;
				}
			}
		}
	}

	return closestRange;
}

async function fallsWithinPreviouslyEditedRanges(previouslyEditedRanges: { [filePath: string]: vscode.Range[] }, closestRange: vscode.FoldingRange, fileVisiting: string): Promise<boolean> {
	if (!previouslyEditedRanges[fileVisiting] || !closestRange) {
		return false;
	}

	for (const range of previouslyEditedRanges[fileVisiting]) {
		if (
			closestRange.start >= range.start.line &&
			closestRange.end <= range.end.line
		) {
			return true;
		}
	}
	return false;
}

async function reiterate(
	buildError: ErrorDiagnostic,
	stream: vscode.ChatResponseStream,
	request: vscode.ChatRequest,
	context: vscode.ChatContext,
	token: vscode.CancellationToken
): Promise<void> {
	const document = await vscode.workspace.openTextDocument(buildError.filePath);
	await vscode.window.showTextDocument(document, { preview: false });
	const editor = vscode.window.activeTextEditor;
	if (!editor || editor.document.languageId !== 'cpp') {
		return;
	}
	var closestRange = await getClosestFoldingRange(editor, buildError.range.start.line);
	var nearestRangeTextSpan: string = '';

	let snippetInputRange: vscode.Range | undefined = undefined;
	if (closestRange) {
		// Store text span of closestRange in nearestRangeTextSpan.
		const start = editor.document.lineAt(closestRange.start).range.start;
		const end = editor.document.lineAt(closestRange.end).range.end;
		snippetInputRange = new vscode.Range(start, end);
		nearestRangeTextSpan = editor.document.getText(snippetInputRange);
	}
	let errorReiterationPrompt = `@refactor The build failed with the following error:\n\n\`\`\`cpp\n${buildError.message}\n\`\`\`\n\Fix the error in the following code snippet.${suffixPrompt}Could it be there are missing #includes?\n\n${nearestRangeTextSpan}`;
	var messages = [vscode.LanguageModelChatMessage.User(errorReiterationPrompt)];
	const reiterationResponse = await request.model.sendRequest(messages, {}, token);
	var reiteratedCodeSnippets = await parseChatResponse(reiterationResponse);

	if (reiteratedCodeSnippets.length > 0) {
		// Parse for includes.
		var includeRegex = /#include\s*["<](.*?)[">]/g;
		var includes: string[] = [];
		let match: RegExpExecArray | null;
		while ((match = includeRegex.exec(reiteratedCodeSnippets[reiteratedCodeSnippets.length - 1])) !== null) {
			includes.push(match[0]);
		}

		// If any includes exist in the fix responde then insert includes at the top of the file.
		// Rest of fix response snippet can be ignored for now since the includes may have been the root issue. If not, it will be caught in the next build+reiteration.
		if (includes.length > 0) {
			const topOfFileRange = new vscode.Range(0, 0, 0, 0);
			const includesText = includes.join('\n') + '\n';
			await applyDynamicEdit(buildError.filePath, topOfFileRange, includesText, stream);
		}
		else {
			await applyDynamicEdit(buildError.filePath, snippetInputRange, reiteratedCodeSnippets[reiteratedCodeSnippets.length - 1], stream);
		}
	}
}

async function applyDynamicEdit(filePath: string, range: vscode.Range | undefined, updatedTextSpan: string | undefined, stream: vscode.ChatResponseStream): Promise<void> {
	const document = await vscode.workspace.openTextDocument(filePath);
	await vscode.window.showTextDocument(document, { preview: false });
	const editor = vscode.window.activeTextEditor;
	if (editor && editor.document.languageId === 'cpp') {
		if (!range) {
			return;
		}

		editor.selection = new vscode.Selection(range.start, range.end);
		editor.revealRange(range, vscode.TextEditorRevealType.InCenter);

		// Replace the range with updatedTextSpan if it exists
		if (updatedTextSpan) {
			const singleEdit = new vscode.WorkspaceEdit();
			// await new Promise(resolve => setTimeout(resolve, 1000));
			singleEdit.replace(editor.document.uri, range, updatedTextSpan);
			await vscode.workspace.applyEdit(singleEdit);
			// await new Promise(resolve => setTimeout(resolve, 1000));
			await editor.document.save();
			await new Promise(resolve => setTimeout(resolve, 1000));
			stream.markdown(`\n\nUpdated code snippet in \`${path.basename(filePath)}\` at line \`${range.start.line}\``);
		}

		editor.selection = new vscode.Selection(range.end, range.end);
	}
}

// This method is called when your extension is activated
export async function invokeRefactoringAgent(request: vscode.ChatRequest, context: vscode.ChatContext, stream: vscode.ChatResponseStream, token: vscode.CancellationToken): Promise<void> {
	const batchableEditCount = 1;

	// Add in the user's message.
	var usersPrompt: string = request.prompt;
	const messages = [vscode.LanguageModelChatMessage.User(usersPrompt)];
	messages.push(vscode.LanguageModelChatMessage.User(suffixPrompt));
	let primaryFilePath = '';
	var primaryOffset: number = 1852;
	const activeEditor = vscode.window.activeTextEditor;
	if (!activeEditor || activeEditor.selection.isEmpty || activeEditor.document.languageId !== 'cpp') {
		return;
	}

	primaryFilePath = activeEditor.document.uri.fsPath;
	const selectedSymbol = activeEditor.document.getText(activeEditor.selection);
	const cursorPosition = activeEditor.selection.active;
	primaryOffset = activeEditor.document.offsetAt(cursorPosition) - 1; // Gets offset from the highlighted symbol, minus 1 to account for the cursor being at the end of the symbol.

	// Get full method range based on the current symbol position.
	const symbolsResult = await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', activeEditor.document.uri);
	const symbols = Array.isArray(symbolsResult) ? symbolsResult as vscode.DocumentSymbol[] : [];
	if (!symbols || symbols.length === 0) {
		return;
	}

	var primaryMethodRange: vscode.Range | undefined = undefined;
	for (const symbol of symbols) {
		if (symbol.name.startsWith(selectedSymbol)) {
			if (symbol.range) {
				primaryMethodRange = symbol.range;
				break;
			}
		}
	}

	if (!primaryMethodRange) {
		return;
	}

	const fullPrimaryMethodTextSpan = activeEditor.document.getText(primaryMethodRange);
	messages.push(vscode.LanguageModelChatMessage.User(`\n\n\`\`\`cpp\n${fullPrimaryMethodTextSpan}\n\`\`\``));
	const initialChatResponse = await request.model.sendRequest(messages, {}, token);

	// Stream the initial chat response to the Copilot Chat UI.
	for await (const fragment of initialChatResponse.text) {
		stream.markdown(fragment);
	}

	var initialChatResponseSnippet = await parseChatResponse(initialChatResponse);
	if (initialChatResponseSnippet.length > 0) {
		const updatedTextSpan = initialChatResponseSnippet[0].toString();
		await applyDynamicEdit(primaryFilePath, primaryMethodRange, updatedTextSpan, stream);
	}

	stream.progress("\n\nSearching for references in database...");
	const client = clients.getClientFor(activeEditor.document.uri);
	if (!client) { throw new Error('No active client found'); }
	const cancellationToken = new vscode.CancellationTokenSource().token;
	var symbolRefs = await client.getRefactorContext(activeEditor.document.uri, primaryOffset, cancellationToken);

	// TODO: Later: Ask user if that is the result they expected?
	// TODO: Later: Generate an example and ask user to confirm if it is correct before applying edits to all refs based on that example.
	// TODO: Later: Extract the symbol from this prompt or selected text to run FAR on it. Ben M. is working on something similar. 

	stream.markdown("\n\nFound \`" + symbolRefs.symbolRefs.length + "\` references in database to update...");
	var numContextItemsUpdated = symbolRefs.symbolRefs.length;
	const previouslyEditedRanges: { [filePath: string]: vscode.Range[] } = {};
	while (symbolRefs.symbolRefs.length > 0) {
		const numEditsToBeBatched = Math.min(batchableEditCount, symbolRefs.symbolRefs.length);
		const batchedCodeSnippets = symbolRefs.symbolRefs.splice(-numEditsToBeBatched, numEditsToBeBatched);
		var generateEditsPrompt: string = `@refactor Now update all of the FillShader::Fill references below to reflect the new functionality of \"${usersPrompt}\".${suffixPrompt}`;
		var shouldExecuteRequest: boolean = false;
		var leadingWhiteSpace: string = '';
		var currentContextItemFilePath: string = '';
		var currentContextItemStartLine: number = 0;
		var currentContextItemClosestFoldingRange: vscode.Range | undefined = undefined;
		for (let i = batchedCodeSnippets.length - 1; i >= 0; i--) {
			var codeSnippetInput = batchedCodeSnippets[i];
			const uri = vscode.Uri.parse(codeSnippetInput.uri);
			currentContextItemFilePath = uri.fsPath.toLowerCase();
			var editor = vscode.window.activeTextEditor;
			if (currentContextItemFilePath != editor?.document.uri.fsPath) {
				const document = await vscode.workspace.openTextDocument(currentContextItemFilePath);
				await vscode.window.showTextDocument(document, { preview: false });
				editor = vscode.window.activeTextEditor;
			}

			if (!editor || editor.document.languageId !== 'cpp') {
				return;
			}

			currentContextItemStartLine = editor.document.positionAt(codeSnippetInput.offset).line;
			if (currentContextItemFilePath.toLowerCase() == primaryFilePath.toLowerCase() && codeSnippetInput.offset == primaryOffset) {
				continue; // Primary file and offset are already handled in initial user prompt so we can skip that reference now.
			}

			var closestRange = await getClosestFoldingRange(editor, currentContextItemStartLine);
			var nearestRangeTextSpan: string = '';

			if (closestRange) {
				if (!previouslyEditedRanges[currentContextItemFilePath.toLowerCase()]) {
					previouslyEditedRanges[currentContextItemFilePath.toLowerCase()] = [];
				}

				const start = editor.document.lineAt(closestRange.start).range.start;
				const end = editor.document.lineAt(closestRange.end).range.end;
				const range = new vscode.Range(start, end);
				if (await fallsWithinPreviouslyEditedRanges(previouslyEditedRanges, closestRange, currentContextItemFilePath.toLowerCase())) {
					continue; // If already edited this range, then skip it.
				}

				previouslyEditedRanges[currentContextItemFilePath.toLowerCase()].push(range);
			}

			if (closestRange) {
				// Store text span of closestRange in nearestRangeTextSpan.
				const start = editor.document.lineAt(closestRange.start).range.start;
				const end = editor.document.lineAt(closestRange.end).range.end;
				let snippetInputRange = new vscode.Range(start, end);
				nearestRangeTextSpan = editor.document.getText(snippetInputRange);
				// trim leading whitespace, indentation, and newlines from nearestRangeTextSpan and store in leadingWhiteSpace.
				const matchLeadingWhitespace = nearestRangeTextSpan.match(/^\s*/);
				leadingWhiteSpace = matchLeadingWhitespace ? matchLeadingWhitespace[0] : '';
				currentContextItemClosestFoldingRange = snippetInputRange;
			}

			stream.progress("Updating code snippet in " + path.basename(currentContextItemFilePath) + " at line " + currentContextItemStartLine + "...");
			generateEditsPrompt += `\n\n\`\`\`${nearestRangeTextSpan}\`\`\``;
			var shouldExecuteRequest: boolean = true;
		}

		if (!shouldExecuteRequest) {
			// Usually occurs if there was no new range(s) that needed to be edited.
			continue;
		}

		// Send dynamic request and get response for each context item.
		// Check token size before sending the request
		const messages = [vscode.LanguageModelChatMessage.User(generateEditsPrompt)];

		// TODO: Use tokenCount to determine if request needs to be split into smaller requests instead of batching.
		// const tokenCount = await request.model.countTokens(generateEditsPrompt);

		const generateEditsChatResponse = await request.model.sendRequest(messages, {}, token);
		var codeSnippets = await parseChatResponse(generateEditsChatResponse);

		if (codeSnippets.length === 0) {
			continue;
		}

		// Apply the edits one at a time.
		var codeSnippetResponseCounter = 0;
		for (let i = batchedCodeSnippets.length - 1; i >= 0; i--) {
			var updatedTextSpan: string = codeSnippets[codeSnippetResponseCounter].toString();
			var codeSnippetInput = batchedCodeSnippets[i];
			await applyDynamicEdit(currentContextItemFilePath, currentContextItemClosestFoldingRange, leadingWhiteSpace + updatedTextSpan, stream);
			codeSnippetResponseCounter++;
		}
	} // End of while loop foriterating through all FARContextItems.


	stream.progress("\n\nBuilding project...");
	var buildResult = await validateEdits();
	var reiterationAttemptsCounter: number = 0;
	while (!buildResult) {
		if (reiterationAttemptsCounter >= 3) {
			reiterationAttemptsCounter = 0;
			// TODO: Ask user to manually fix errors, then click this button to continue the agent.
		}

		stream.markdown("\n\nBuild failed. Agent will attempt to fix error(s)...");
		const allDiagnostics = vscode.languages.getDiagnostics();
		let buildErrorsInHeaderFiles: ErrorDiagnostic[] = [];
		let buildErrorsInSourceFiles: ErrorDiagnostic[] = [];
		for (const [uri, diagnostics] of allDiagnostics) {
			for (const diagnostic of diagnostics) {
				// const normalizedFsPath = uri.fsPath.replace(/\\/g, '/');
				if (diagnostic.severity === vscode.DiagnosticSeverity.Error && uri.fsPath.toLowerCase() in previouslyEditedRanges) {
					const isHeader = uri.fsPath.endsWith('.h') || uri.fsPath.endsWith('.hpp');
					if (isHeader) {
						const error: ErrorDiagnostic = {
							filePath: uri.fsPath,
							message: diagnostic.message,
							range: diagnostic.range
						};
						buildErrorsInHeaderFiles.push(error);
					}
					else {
						const error: ErrorDiagnostic = {
							filePath: uri.fsPath,
							message: diagnostic.message,
							range: diagnostic.range
						};
						buildErrorsInSourceFiles.push(error);
					}
				}
			}
		}

		// Identify the correct build error to pass in first to reiterate on.
		let buildErrorToReiterateOn: ErrorDiagnostic | undefined;
		if (buildErrorsInHeaderFiles.length > 0) {
			// Iterate through errors from header files first from top to bottom since those are more likely to be the root cause of cascading issues.
			buildErrorToReiterateOn = buildErrorsInHeaderFiles[0];
		}
		else if (buildErrorsInSourceFiles.length > 0) {
			buildErrorToReiterateOn = buildErrorsInSourceFiles[0];
		}

		if (buildErrorToReiterateOn) {
			// Reiterate and build again to validate new edits.
			await reiterate(buildErrorToReiterateOn, stream, request, context, token);
			stream.progress("\n\nBuilding project...");
			buildResult = await validateEdits();
			reiterationAttemptsCounter++;
		}
	} // while loop for validating edits and reiterating.

	// Build has fully succeeded.
	stream.markdown(`\n\nBuild succeeded. Successfully applied \`${numContextItemsUpdated}\` edits`);

	// Launch the git diff viewer tool to show all the changes made.
	try {
		await vscode.commands.executeCommand('workbench.view.scm');
	} catch (err) {
		console.error('Failed to open Source Control view:', err);
	}

	const finalDocToDisplay = await vscode.workspace.openTextDocument(primaryFilePath);
	await vscode.window.showTextDocument(finalDocToDisplay, { preview: false });

	return;
}
