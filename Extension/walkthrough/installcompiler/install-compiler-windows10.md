<h1 data-loc-id="walkthrough.windows.install.compiler">Install a C++ compiler on Windows</h1>
<p data-loc-id="walkthrough.windows.text1">If you&#39;re doing C++ development for Windows, we recommend installing the Microsoft Visual C++ (MSVC) compiler.</p>
<ol>
<li><p data-loc-id="walkthrough.windows.text2">To install MSVC, open the VS Code terminal (CTRL + `) and paste in the following command:
<pre><code style="white-space: pre-wrap;">winget install Microsoft.VisualStudio.2022.BuildTools --force --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --add Microsoft.VisualStudio.Component.VC.Tools.x86.x64 --add Microsoft.VisualStudio.Component.Windows10SDK.20348"</code></pre>
</li>
<blockquote>
<p><strong data-loc-id="walkthrough.windows.note1">Note</strong>: <span data-loc-id="walkthrough.windows.note1.text">You can use the C++ toolset from Visual Studio Build Tools along with Visual Studio Code to compile, build, and verify any C++ codebase as long as you also have a valid Visual Studio license (either Community, Pro, or Enterprise) that you are actively using to develop that C++ codebase.</span></p>
</blockquote>
</li>
</ol>
<h2 data-loc-id="walkthrough.windows.verify.compiler">Verifying the compiler installation</h2>
<ol>
<li><p data-loc-id="walkthrough.windows.open.command.prompt">Open the <strong>Developer Command Prompt for VS</strong> by typing &#39;<code>developer</code>&#39; in the Windows Start menu.</p>
</li>
<li><p data-loc-id="walkthrough.windows.check.install">Check your MSVC installation by typing <code>cl</code> into the <span>Developer Command Prompt for VS</span>. You should see a copyright message with the version and basic usage description.</p>
<blockquote>
<p><strong data-loc-id="walkthrough.windows.note2">Note</strong>: <span data-loc-id="walkthrough.windows.note2.text">To use MSVC from the command line or VS Code, you must run from a <strong>Developer Command Prompt for VS</strong>. An ordinary shell such as <span>PowerShell</span>, <span>Bash</span>, or the Windows command prompt does not have the necessary path environment variables set.</span></p>
</blockquote>
</li>
</ol>
<h2 data-loc-id="walkthrough.windows.other.compilers">Other compiler options</h2>
<p data-loc-id="walkthrough.windows.text3">If you&#39;re targeting Linux from Windows, check out <a href="https://code.visualstudio.com/docs/cpp/config-wsl" data-loc-id="walkthrough.windows.link.title1">Using C++ and Windows Subsystem for Linux (WSL) in VS Code</a>. Or, you could <a href="https://code.visualstudio.com/docs/cpp/config-mingw" data-loc-id="walkthrough.windows.link.title2">install GCC on Windows with MinGW</a>.</p>