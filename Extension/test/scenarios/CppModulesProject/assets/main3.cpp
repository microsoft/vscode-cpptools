// Module importer used by the custom configuration provider tests
// (MSVC-style module compiler arguments).

import math;
import geometry;

// Sentinel probe: this define is only provided through the compilerArgs of the
// custom configuration provider used by the tests. The hover assertion proves
// that the provider's arguments (which also carry the MSVC module arguments)
// were delivered to the language server for this translation unit.
#ifdef PROVIDER_MSVC_SENTINEL
int provider_msvc_sentinel_value = 1;
#endif

int probe_provider_msvc()
{
    return provider_msvc_sentinel_value;
}

int main()
{
    return add(3, 4) + square_area(5) - math::k_answer;
}
