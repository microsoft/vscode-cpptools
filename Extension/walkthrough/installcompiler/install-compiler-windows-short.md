<h1 data-loc-id="walkthrough.windows.install.compiler">Install the Microsoft Visual C++ compiler (MSVC) on Windows</h1>
<p>Download <a href="https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022" data-loc-id="walkthrough.windows.link.downloads"><strong data-loc-id="walkthrough.windows.build.tools1">Build Tools for Visual Studio 2022</strong></a>.</p>

<p data-loc-id="walkthrough.windows.text3">In the Visual Studio Build Tools Installer, check the <strong data-loc-id="walkthrough.windows.build.tools2">C++ desktop</strong> workload and select <strong data-loc-id="walkthrough.windows.link.install">Install</strong>.</p>



Verify your MSVC installation by opening the <strong data-loc-id="walkthrough.windows.command.prompt.name1">Developer Command Prompt for VS</strong> and running:</p> 

<pre><code class="lang-bash">cl
</code></pre>

Then, navigate to your project directory and run <pre><code class="lang-bash">code .
</code></pre>to open VS Code with the necessary path environment variables.</span></p>
</ul>
<blockquote>
<p><strong data-loc-id="walkthrough.windows.note1">Note</strong>: <span data-loc-id="walkthrough.windows.note1.text">You must have a valid Visual Studio license to use the C++ toolset from Visual Studio Build Tools with VS Code.</span></p>
</blockquote>

If you&#39;re targeting Linux from Windows, check out <a href="https://code.visualstudio.com/docs/cpp/config-wsl" data-loc-id="walkthrough.windows.link.title1">Using C++ and Windows Subsystem for Linux (WSL) in VS Code</a>. Or, you could <a href="https://code.visualstudio.com/docs/cpp/config-mingw" data-loc-id="walkthrough.windows.link.title2">install GCC on Windows with MinGW</a>.</p>
</li>
</ol>
