
# Performance Notes
I moved the entire discover/identify process to a nodejs `worker_thread` (a background thread).
This is useful when the foreground app has cpu-intensive work or a lot of things in the event loop.

Technically, this wouldn't be super important to do if everything was *simply* async IO bound, but the startup
of the extension is kinda CPU intensive (as ), and moving the logic to a worker thread completely frees up the 
foreground to do what it needs to. 



# Results

| Initial State | selecting compiler | discovery in init? | time to identify | time to get intellisense |
| ------------- | ------------------ | ------------------ | ---------------- | ------------------------ |
| no cache      | explicit path      | no                 | 600-700 ms       | 550-745 ms               |
| no cache      | explicit path      | yes                | 1000-1350 ms     | 1625-1675 ms             |
| no cache      | by name/wildcard   | no                 | 6900-7100 ms     | 700-730 ms               |
| no cache      | by name/wildcard   | yes                | 5900-6100 ms     | 700-720 ms               |
| cached        | explicit path      | no                 | 6-7 ms           | 6-15 ms                  |
| cached        | explicit path      | yes                | 6-8 ms           | 6-19 ms                  |
| cached        | by name/wildcard   | no                 | 6-7 ms           | 6-15 ms                  |
| cached        | by name/wildcard   | yes                | 6-7 ms           | 6-15 ms                  |

1. "cached" means that the extension has already performed some discovery 
   or identification at some point, and it loaded the previously used data from 
   the cache. 

2. "no cache" means that the extension has not performed any discovery or 
   identification at all, the extension has to identify the compiler from scratch.

3. "explicit path" means that in the `c_cpp_properties.json` file, the full path 
   is specified in the `compiler` field. 
 
   The compiler can be identified soley by path, and doesn't have to wait
   for full discovery to complete. If the data is cached, it's a fast lookup.

4. "by name/wildcard" means that in the `c_cpp_properties.json` file, the compiler
   is specified by name (with or without a wildcard).

   The compiler can be identified quickly if there are cached entries, but if there isn't
   we have to wait for full discovery to be done. 

5. "discover in init = yes" means that the discovery process is initiated in the background 
   during initialization. If there are any cached entries, then it waits 5 seconds before kicking 
   it off in the background. If there are zero cached entries, then it kicks it off immediately.

6. "discover in init = no" means that the discovery process is not initiated in the background 
   during initialization. It is only kicked off when the extension needs to identify a compiler
   and it misses the cache hit.  


Notes :
  - if the `compiler` field isn't in the intellisense, we're not activating any of this.
  
  - when we enable the extension to prompt the user which compiler to use, we have to 
    have discovery done (~6-12 seconds) before we can prompt the user. 

    This may be a good reason to have discovery done in the background during initialization
    every time.

  - Cached data is stored in a single JSON file in the global storage path for the extension
  
  - Cached data is loading on startup. 
  
  - Cached data is saved every time the extension does something that alters the data in the cache.  
    - discovery finds a compiler  
    - a (new/different) intellisense config is generated for a given command line  
    - a (new/different) query of a compiler is done  

    
Questions:
  - The cached data is globally stored for all instances of vscode.
  - that means that currently, 'last-one-wins' is how it's being stored.
  - I'm leaning towards making it load/merge/store whenever any instance is about to modify the cache file.
    - this would make the cache more and more accurate over time, and effort by a single instance would benefit 
      all instances
    - I *can* enable a staleness timeout on things in the cache (even partially, so like queries/analysis). Currently, this file would grow and grow over time
      and get somewhat large. A missed cache hit could incur a hit of 500 to 2000 ms depending on how much work it has 
      to do. 
        - if we stale out the whole toolset entry, then we'd have to run identify on that one again the next time (more expensive, and could trigger a full discovery)
        - if we stale out just the queries/analysis, then just those would be regenerated/rerun when the intellisense config  (not as expensive, and doesn't require us to do discovery again)
  
