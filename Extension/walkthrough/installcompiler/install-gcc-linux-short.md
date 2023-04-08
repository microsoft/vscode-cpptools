<h1 data-loc-id="walkthrough.linux.install.compiler">Install a C++ compiler on Linux</h1>
<p>You can install the GCC compiler on Linux by running the following commands in a terminal:</p>

<pre><code class="lang-bash">sudo apt-<span class="hljs-built_in">get</span> <span class="hljs-keyword">update</span>
</code></pre>
<pre><code class="lang-bash">sudo apt-<span class="hljs-meta">get</span> install <span class="hljs-keyword">build-essential </span>gdb
</code></pre>
<p>Verify GCC is installed: </p>
<pre><code class="lang-bash">gcc <span class="hljs-comment">--version</span>
</code></pre>
