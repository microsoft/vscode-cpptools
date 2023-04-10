<h1 data-loc-id="walkthrough.linux.install.compiler">Install a C++ compiler on Linux</h1>
<p data-loc-id="walkthrough.linux.text1">If you&#39;re doing C++ development for Linux, we recommend installing the GCC compiler. Installing GCC is simple, just follow these three steps:</p>
<ol>
<li><p data-loc-id="walkthrough.linux.text2">Run the following command from the terminal window to update the Ubuntu package lists. An out-of-date Linux distribution can sometimes interfere with attempts to install new packages.</p>
<pre><code class="lang-bash">sudo apt update</code></pre>
</li>
<li><p data-loc-id="walkthrough.linux.text3">Install the GNU compiler tools and the GDB debugger with this command:</p>
<pre><code class="lang-bash">sudo apt install build-essential gdb
</code></pre>
</li>
<li><p data-loc-id="walkthrough.linux.text4">Verify GCC is installed by running the following command. You should see a copyright message and information about the version of GCC you&#39;re using.</p>
<pre><code class="lang-bash">gcc --version</code></pre>
</li>
</ol>
