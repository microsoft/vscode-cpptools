#include "levelTwoFile.h"

namespace foo {
      namespace bar {
            namespace baz {
                  int qux = 42;
            }
      }
}

namespace foo::bar::baz
{
	namespace foo3
	{
		class c {};
	}
}

int main()
{
    return 0;
}