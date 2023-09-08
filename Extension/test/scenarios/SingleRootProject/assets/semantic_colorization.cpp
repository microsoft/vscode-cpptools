
// The following file exercises all semantic tokens supported by the C/C++ Extension.
//
// To test, toggle the setting "C_Cpp.enhancedColorization" between "Enabled" and "Disabled".
// All tokens referred to as being "colored semantically" below, should be colored differently if enabled.
//
// Some language features (ref classes, value classes, etc.) require C++/CLI support to be enabled.
// Enable C++/CLI by configuring the C/C++ Extension to use "cl.exe" as the compiler (so, on WIndows),
// and set "compilerArgs" to: ["/clr"]
//
// Use the Dark+ theme to test.
// Since not all semantic tokens are colored by the Dark+ theme, add the following settings:
//
// "editor.semanticTokenColorCustomizations": {
//     "enabled": true,
//     "rules": {
//         "event": "#FF0000",
//         "genericType": "#ff0000",
//         "variable.global": "#ff0000",
//         "label": "#ff0000",
//         "macro": "#ff0000",
//         "property": "#ff0000",
//         "namespace": "#ff0000",
//         "newOperator": "#ff0000",
//         "operatorOverload": "#ff0000",
//         "memberOperatorOverload": "#ffff00",
//         "parameter": "#ff0000",
//         "referenceType": "#ff0000",
//         "property.static": "#ffff00",
//         "member.static": "#ffff00",
//         "type": "#00ff00",
//         "numberLiteral": "#ff0000",
//         "stringLiteral": "#00ff00",
//         "customLiteral": "#ffff00",
//         "valueType": "#ffff00",
//         "cliProperty": "#ffff00"
//     } 
// }
//
// To test backwards compatibility, also test using legacy TextMate scopes:
//
// "editor.tokenColorCustomizations": {
//     "textMateRules": [
//         {
//             "scope": "variable.other.event",
//             "settings": {
//                 "foreground": "#FF0000"
//             }
//         },
//         {
//             "scope": "entity.name.type.class.generic",
//             "settings": {
//                 "foreground": "#FF0000"
//             }
//         },
//         {
//             "scope": "variable.other.global",
//             "settings": {
//                 "foreground": "#FF0000"
//             }
//         },
//         {
//             "scope": "entity.name.label",
//             "settings": {
//                 "foreground": "#FF0000"
//             }
//         },
//         {
//             "scope": "entity.name.function.preprocessor",
//             "settings": {
//                 "foreground": "#FF0000"
//             }
//         },
//         {
//             "scope": "variable.other.property",
//             "settings": {
//                 "foreground": "#FF0000"
//             }
//         },
//         {
//             "scope": "entity.name.namespace",
//             "settings": {
//                 "foreground": "#FF0000"
//             }
//         },
//         {
//             "scope": "keyword.operator.new",
//             "settings": {
//                 "foreground": "#FF0000"
//             }
//         },
//         {
//             "scope": "entity.name.function.operator",
//             "settings": {
//                 "foreground": "#FF0000"
//             }
//         },
//         {
//             "scope": "entity.name.function.operator.member",
//             "settings": {
//                 "foreground": "#FFFF00"
//             }
//         },
//         {
//             "scope": "variable.parameter",
//             "settings": {
//                 "foreground": "#FF0000"
//             }
//         },
//         {
//             "scope": "entity.name.type.class.reference",
//             "settings": {
//                 "foreground": "#FF0000"
//             }
//         },
//         {
//             "scope": "variable.other.property.static",
//             "settings": {
//                 "foreground": "#FFFF00"
//             }
//         },
//         {
//             "scope": "entity.name.function.member.static",
//             "settings": {
//                 "foreground": "#FFFF00"
//             }
//         },
//         {
//             "scope": "entity.name.type",
//             "settings": {
//                 "foreground": "#00FF00"
//             }
//         },
//         {
//             "scope": "entity.name.operator.custom-literal.number",
//             "settings": {
//                 "foreground": "#FF0000"
//             }
//         },
//         {
//             "scope": "entity.name.operator.custom-literal.string",
//             "settings": {
//                 "foreground": "#00FF00"
//             }
//         },
//         {
//             "scope": "entity.name.operator.custom-literal",
//             "settings": {
//                 "foreground": "#FFFF00"
//             }
//         },
//         {
//             "scope": "entity.name.type.class.value",
//             "settings": {
//                 "foreground": "#FFFF00"
//             }
//         },
//         {
//             "scope": "variable.other.property.cli",
//             "settings": {
//                 "foreground": "#FFFF00"
//             }
//         }
//     ]
// }
//
// Documentation on these scopes can be found here: https://code.visualstudio.com/docs/cpp/colorization-cpp

// Class Template - entity.name.type.class.templated
template <typename T>
class template_class // "template_class" colored syntactically
{
};

template_class<int> instance; // "template_class" colored semantically

// Enumerator - variable.other.enummember
enum enum_type {
    enum_member = 0 // "enum_member" colored syntactically
};

enum_type enum_instance = enum_type::enum_member; // "enum_member" colored semantically

// Event (C++/CLI) - variable.other.event
// This requiress CLR support. i.e. Use cl.exe and: "compilerArgs": ["/clr"]
delegate void event_delegate();
ref class A
{
    event event_delegate^ event_instance; // "event_instance" colored semantically
};

// Function - entity.name.function
void function() { } // "function" colored synatically
void function2()
{
    function(); // "function" colored synatically
    void(*function_pointer)() = &function; // "function" color semantically
}

// Function Template - entity.name.function.templated
template <typename T>
void template_function()
{
    template_function<int>();
    void(*function_pointer)() = &function<int>; // "function" color semantically
}

// Generic Type (C++/CLI) - entity.name.type.class.generic
// This requiress CLR support. i.e. Use cl.exe and: "compilerArgs": ["/clr"]
// KNOWN BUG: https://developercommunity.visualstudio.com/content/problem/565052/color-setting-for-c-user-types-generic-types-does.html
generic <class T>
ref class generic_class
{
};

void generic_class_test()
{
    generic_class<int> generic_class_instance; // "generic_class_instance" colored semantically
}

// Global Variable - variable.other.global
int global_instance; // "global_instance" colored semantically

// Label - entity.name.label
void label_test()
{
    goto Label1; // "Label1" colored semantically
Label1: // "Label1" colored syntactically
}

// Local Variable - variable.other.local
void local_variable_test()
{
    int local_instance; // "local_instance" colored semantically
}

// Macro - entity.name.function.preprocessor
#define MACRO(a, b) // "local_instance" colored syntactically
MACRO(a, b) // "local_instance" colored semantically

// Member Field - variable.other.property
class member_field_test
{
    int member_instance; // "member_instance" colored semantically
};

// Member Function - entity.name.function.member
class C
{
public:
    void member_function() { } // "member_function" colored syntactically
};

void member_function_test()
{
    void(C::*member_function_ptr)() = &C::member_function; // "member_function" colored semantically
};

// Namespace - entity.name.namespace
namespace my_namespace {
class A
{
};
}

my_namespace::A a; // "my_namesapce" color semantically
    // "my_namespace" will also be colored synatically as a "entity.name.scope-resolution.cpp".
    // Use a distinct color for entity.name.namespace to see the difference


// New / Delete - keyword.operator.new
struct operator_new_test_class
{
    void* operator new(size_t sz); // "operator new" is colored semantically
};

// Operator Overload Function - entity.name.function.operator
class OOF { };
OOF& operator+=(OOF& b1, OOF& b2) // "operator+=" is colored semantically
{
    b1 += b2; // "+=" is colored semantically
    return b1;
};

// Operator Overload Member - entity.name.function.operator.member
class OOM {
    OOM& operator+=(OOM& b) // "operator+=" is colored semantically
    {
        *this += b; // "+=" is colored semantically
        return *this;
    };
};

// Parameter - variable.parameter
void param_test(int param1)
{
    int i = param1; // "param1" is colored semantically here, where used.
}

// Property (C++/CLI) - variable.other.property.cli
ref class ref_class_with_property {
public:
   property int prop; // "prop" is colored semantically
};
void property_test(ref_class_with_property^ obj)
{
   obj->prop = 111; // "prop" is colored semantically
}

// Reference Type (C++/CLI) - entity.name.type.class.reference
ref class ref_class // "ref_class" is colored semantically
{
};
void ref_test()
{
    ref_class a; // "ref_class" is colored semantically
}

// Static Member Field - variable.other.property.static
struct static_member_test
{
    static int static_member_instance; // "static_member_instance" is colored semantically
    void foo()
    {
        static_member_instance = 2; // "static_member_instance" is colored semantically
    }
};

// Static Member Function - entity.name.function.member.static
struct static_member_test
{
    static void foo() // "static_member_instance" is colored semantically
    {
        foo(); // "static_member_instance" is colored semantically
    }
};

// Type - entity.name.type
class my_class
{
};
void my_class_test()
{
    my_class c; // "my_class" is colored semantically here
}

// User-Defined Literal - Number - entity.name.operator.custom-literal.number
unsigned long long operator""_numeric(unsigned long long i) // "operator""_numeric" is colored semantically
{
    return 12345_numeric; // "12345_numeric" is colored semantically
}

// User-Defined Literal - String - entity.name.operator.custom-literal.string
const char* operator""_str(const char* arr, size_t size) // "operator""_str" is colored semantically
{
    "ABC"_str; // ""ABC"_str" is colored semantically
}

// User-Defined Literal - Raw - entity.name.operator.custom-literal
void operator"" _custom(const char* i) // "operator"" _custom" is colored semantically
{
    0xABC_custom; // "0xABC_custom" is colored semantically
}


// Value Type (C++/CLI) - entity.name.type.class.value
value class value_class // "value_class" is colored semantically
{
};
void value_test()
{
    value_class a; // "value_class" is colored semantically
}
