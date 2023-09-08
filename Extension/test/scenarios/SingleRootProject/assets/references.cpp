namespace foo {
	namespace bar {
		namespace baz {
			int qux = 42;
		}
	}
}

namespace foo::bar::baz
{
}

#include "references.h"

using namespace nsReferences;

int var1; // file scope extern
int func1(); // declaration
int func1(float var1) // local param
{
    {
        double var1 = 0; // new local scope
        return var1;
    }
    return var1 + func1();
}

int func1() // overload. Returns confirmed and non-confirmed references.
{
    if (var1 == 0)
        return func1(0);
}

void func2()
{
    funcInHeader1();
}

void func3()
{
    // func1 comment reference func1 (source file)
    const char *s = "func1"; // string reference
#if 0
    func1(0); // inactive reference
#endif
    cannotConfirmReference1;
    {
        int cannotConfirmReference1;
    }
}

const char* myLibStr = "MyLibStr"; // References in the IDL
#include "testIdl.idl"
void MyTypeLibrary() { return ; } // Not an IDL reference
