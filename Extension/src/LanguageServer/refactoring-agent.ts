import * as vscode from 'vscode';
const path = require('path'); // Import Node.js path module
import { initialCodeSnippetInput } from './hard-coded-refactoring-agent-inputs';
import { codeSnippetInputs } from './hard-coded-refactoring-agent-inputs';
let suffixPrompt = " Output the changed code along with the rest of the entire input code snippet unchanged. Make sure entire output is formatted correctly";

interface ErrorDiagnostic {
	filePath: string;
	message: string;
	range: vscode.Range;
}

export interface CodeSnippetInput {
	textSpan: string;
	updatedTextSpan?: string,
	filePath: string;
	startLine: number;
	startColumn: number;
	endLine: number;
	endColumn: number;
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
		// TODO: Need to add a clean here for a full rebuild? Misses errors sometimes if not.
		await vscode.commands.executeCommand('cmake.clean');
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
	"public": true,
	"do": true,
	"while": true,
	"for": true,
	"switch": true
};

async function getClosestFoldingRange(editor: vscode.TextEditor, startLine: number): Promise<vscode.FoldingRange | undefined> {
	await new Promise(resolve => setTimeout(resolve, 1000));
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
				const startsWithBracket = nearestRangeTextSpan.trim().startsWith('{');
				if (startsWithBracket)
				{
					closestRange = range;
					closestRange.start += 1; // Increment start by 1 if it starts with a bracket to avoid adding bracket into the snippet.
				}
				else if (startsWithKeyword)
				{
					closestRange = range;
				}
			}
		}
	}

	if (!closestRange) {
		return closestRange;
	}

	// check if nearestRangeTextSpan contains an opening brace '{' at the start of the text span.
	// if (nearestRangeTextSpan.trim().startsWith('{')) {
	// 	closestRange.start += 1;
	// }

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
	const reiterationResponse = await request.model.sendRequest(messages, { }, token);
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
			await applyDynamicEdit(buildError.filePath, topOfFileRange, includesText);
		}
		else
		{
			await applyDynamicEdit(buildError.filePath, snippetInputRange, reiteratedCodeSnippets[reiteratedCodeSnippets.length - 1]);
		}
	}
}

async function applyDynamicEdit(filePath: string, range: vscode.Range | undefined, updatedTextSpan: string| undefined): Promise<void> {
	const document = await vscode.workspace.openTextDocument(filePath);
	await vscode.window.showTextDocument(document, { preview: false });
	const editor = vscode.window.activeTextEditor;
	if (editor && editor.document.languageId === 'cpp') {
		if (!range) {
			return;
		}
		// const range = new vscode.Range(
		// 	codeSnippetInput.startLine,
		// 	codeSnippetInput.startColumn,
		// 	codeSnippetInput.endLine,
		// 	codeSnippetInput.endColumn
		// );

		// TODO: Do I not need this anymore?
		editor.selection = new vscode.Selection(range.start, range.end);
		editor.revealRange(range, vscode.TextEditorRevealType.InCenter);

		// Replace the range with updatedTextSpan if it exists
		if (updatedTextSpan) {
			// To avoid overlap, create a new WorkspaceEdit for each operation and apply immediately
			const singleEdit = new vscode.WorkspaceEdit();
			await new Promise(resolve => setTimeout(resolve, 1000));
			singleEdit.replace(editor.document.uri, range, updatedTextSpan);
			await vscode.workspace.applyEdit(singleEdit);
			await new Promise(resolve => setTimeout(resolve, 1000));
			await editor.document.save();
			await new Promise(resolve => setTimeout(resolve, 1000));
		}
	}
}

// This method is called when your extension is activated
export async function invokeRefactoringAgent(request: vscode.ChatRequest, context: vscode.ChatContext, stream: vscode.ChatResponseStream, token: vscode.CancellationToken): Promise<void> {
	const batchableEditCount = 1;
	// Initialize the prompt.
	let prompt = "";

	// Initialize the messages array with the prompt.
	// TODO: Can remove this later?
	const messages = [vscode.LanguageModelChatMessage.User(prompt)];

	// Get all the previous participant messages.
	const previousMessages = context.history.filter(
		h => h instanceof vscode.ChatResponseTurn
	);

	// Add the previous messages to the messages array.
	// TODO: Can possible comment out this history context.
	previousMessages.forEach(m => {
		let fullMessage = '';
		m.response.forEach(r => {
		const mdPart = r as vscode.ChatResponseMarkdownPart;
		fullMessage += mdPart.value.value;
		});
		messages.push(vscode.LanguageModelChatMessage.Assistant(fullMessage));
	});

	// Add in the user's message.
	var usersPrompt: string = request.prompt;
	messages.push(vscode.LanguageModelChatMessage.User(usersPrompt));
	messages.push(vscode.LanguageModelChatMessage.User(suffixPrompt));
	let selectedText = '';
	const activeEditor = vscode.window.activeTextEditor;
	let activeFilePath = '';
	if (activeEditor) {
		activeFilePath = activeEditor.document.uri.fsPath;
	}
	if (activeEditor && !activeEditor.selection.isEmpty) {
		selectedText = activeEditor.document.getText(activeEditor.selection);
		messages.push(vscode.LanguageModelChatMessage.User(`\n\n\`\`\`cpp\n${selectedText}\n\`\`\``));
	} else if (activeEditor) {
		const entireActiveFileText = activeEditor.document.getText();
		messages.push(vscode.LanguageModelChatMessage.User(`\n\n\`\`\`cpp\n${entireActiveFileText}\n\`\`\``));
	}

	const initialChatResponse = await request.model.sendRequest(messages, {}, token);
	var initialChatResponseSnippet = await parseChatResponse(initialChatResponse);
	if (initialChatResponseSnippet.length > 0)
	{
		initialCodeSnippetInput[0].updatedTextSpan = initialChatResponseSnippet[0].toString();
		let initialCodeSnippetRange = new vscode.Range(
			initialCodeSnippetInput[0].startLine,
			initialCodeSnippetInput[0].startColumn,
			initialCodeSnippetInput[0].endLine,
			initialCodeSnippetInput[0].endColumn
		);
		await applyDynamicEdit(activeFilePath, initialCodeSnippetRange, initialCodeSnippetInput[0].updatedTextSpan);
	}

	// Stream the initial chat response to the Copilot Chat UI.
	for await (const fragment of initialChatResponse.text) {
		stream.markdown(fragment);
	}

	// TODO: Run FAR and get codeSnippetLocations for references.
	// TODO: Later: Ask user if that is the result they expected?
	// TODO: Later: Generate an example and ask user to confirm if it is correct before applying edits to all refs based on that example.
	// TODO: Later: Extract the symbol from this prompt or selected text to run FAR on it. Ben M. is working on something similar. 

	var numEditsMade = 0;
	const previouslyEditedRanges: { [filePath: string]: vscode.Range[] } = {};
	while (codeSnippetInputs.length > 0) {
		const numEditsToBeBatched = Math.min(batchableEditCount, codeSnippetInputs.length);
		const batchedCodeSnippets = codeSnippetInputs.splice(-numEditsToBeBatched, numEditsToBeBatched);
		// TODO: Try to adjust prompting to only update call site locations, might need to pass those in as an array? Or try passing in only a fixed range of code around the reference location?
		var generateEditsPrompt: string = `@refactor Now update all of the FillShader::Fill references below to reflect the new functionality of \"${usersPrompt}\".${suffixPrompt}`;
		var shouldExecuteRequest: boolean = false;
		var leadingWhiteSpace: string = '';
		for(let i = batchedCodeSnippets.length - 1; i >= 0; i--) {
			var codeSnippetInput = batchedCodeSnippets[i];
			var editor = vscode.window.activeTextEditor;
			if (batchedCodeSnippets[i].filePath != editor?.document.uri.fsPath)
			{
				const document = await vscode.workspace.openTextDocument(batchedCodeSnippets[i].filePath);
				await vscode.window.showTextDocument(document, { preview: false });
				editor = vscode.window.activeTextEditor;
			}

			if (!editor || editor.document.languageId !== 'cpp') {
				return;
			}

			var closestRange = await getClosestFoldingRange(editor, codeSnippetInput.startLine);
			var nearestRangeTextSpan: string = '';

			if (closestRange) {
				if (!previouslyEditedRanges[codeSnippetInput.filePath.toLowerCase()]) {
					previouslyEditedRanges[codeSnippetInput.filePath.toLowerCase()] = [];
				}

				const start = editor.document.lineAt(closestRange.start).range.start;
				const end = editor.document.lineAt(closestRange.end).range.end;
				const range = new vscode.Range(start, end);
				if (await fallsWithinPreviouslyEditedRanges(previouslyEditedRanges, closestRange, codeSnippetInput.filePath.toLowerCase()))
				{
					continue; // If already edited this range, then skip it.
				}

				previouslyEditedRanges[codeSnippetInput.filePath.toLowerCase()].push(range);
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
				batchedCodeSnippets[i].closestRange = snippetInputRange;
			}

			stream.progress("Updating code snippets in " + path.basename(batchedCodeSnippets[i].filePath) + " at line " + batchedCodeSnippets[i].startLine + "...");
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

		const generateEditsChatResponse = await request.model.sendRequest(messages, { }, token);
		var codeSnippets = await parseChatResponse(generateEditsChatResponse);

		if (codeSnippets.length === 0)
		{
			continue;
		}

		// Apply the edits one at a time.
		var codeSnippetResponseCounter = 0;
		for(let i = batchedCodeSnippets.length - 1; i >= 0; i--) {
			batchedCodeSnippets[i].updatedTextSpan = codeSnippets[codeSnippetResponseCounter].toString();
			var codeSnippetInput = batchedCodeSnippets[i];
			await applyDynamicEdit(codeSnippetInput.filePath, codeSnippetInput.closestRange, leadingWhiteSpace + codeSnippetInput.updatedTextSpan);
			numEditsMade++;
			stream.markdown("\n\nSuccessfully updated code snippet in \`" + path.basename(batchedCodeSnippets[i].filePath) + "\` at line \`" + batchedCodeSnippets[i].startLine);

			// TODO: Each time an edit is applied, we should validate it using build, and if fails then validate using error list.
			// TODO: Reiterate if necessary.
			codeSnippetResponseCounter++;
		}
	} // End of while loop foriterating through all codeSnippetInputs.


	var buildResult = await validateEdits();
	while (!buildResult) {
		stream.markdown("\n\n\nBuild failed. Please check the output for errors.");
		const allDiagnostics = vscode.languages.getDiagnostics();
		let buildErrorsInHeaderFiles: ErrorDiagnostic[] = [];
		let buildErrorsInSourceFiles: ErrorDiagnostic[] = [];
		for (const [uri, diagnostics] of allDiagnostics) {
			for (const diagnostic of diagnostics) {
				const normalizedFsPath = uri.fsPath.replace(/\\/g, '/');
				if (diagnostic.severity === vscode.DiagnosticSeverity.Error && normalizedFsPath.toLowerCase() in previouslyEditedRanges) {
					const isHeader = uri.fsPath.endsWith('.h') || uri.fsPath.endsWith('.hpp');
					if (isHeader)
					{
						const error: ErrorDiagnostic = {
							filePath: uri.fsPath,
							message: diagnostic.message,
							range: diagnostic.range
						};
						buildErrorsInHeaderFiles.push(error);
					}
					else
					{
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
		else if (buildErrorsInSourceFiles.length > 0)
		{
			buildErrorToReiterateOn = buildErrorsInSourceFiles[0];
		}

		if (buildErrorToReiterateOn) {
			// Reiterate and build again to validate new edits.
			await reiterate(buildErrorToReiterateOn, stream, request, context, token);
			buildResult = await validateEdits();
		}
	} // while loop for validating edits and reiterating.

	// Build has fully succeeded.
	stream.markdown("\n\n\nBuild succeeded. All edits applied successfully.");
	stream.markdown(`\n\n\nSuccessfully applied \`${numEditsMade}\` edits.`);
	
	// Launch the git diff viewer tool to show all the changes made.
	try {
		await vscode.commands.executeCommand('workbench.view.scm');
	} catch (err) {
		console.error('Failed to open Source Control view:', err);
	}

	return;
}

// Temporary code to apply a patch using patch.exe
/*
			const patchExe = "c:\\Program Files\\Git\\usr\\bin\\patch.exe";
			const diffFile = path.join(
				path.dirname(codeSnippetInput.filePath),
				path.basename(codeSnippetInput.filePath, path.extname(codeSnippetInput.filePath)) + '.diff'
			);

			fs.writeFileSync(diffFile, codeSnippetInput.gitPatchText, 'utf8');
			const patchCmd = `\"${patchExe}\" --binary --strip 0 --fuzz 5 -i "${diffFile}"`;
			await new Promise<void>((resolve, reject) => {
				exec(patchCmd, { cwd: path.dirname(codeSnippetInput.filePath) }, (error: any, stdout: string, stderr: string) => {
					if (error) {
						vscode.window.showErrorMessage(`Patch failed: ${stderr}`);
						reject(error);
					} else {
						resolve();
					}
				});
			});
*/