
# VSCode C/C++ Extension - Enhanced Colorization

The VSCode C/C++ extension now supports lexical/syntactic and semantic colorization, using IntelliSense.

# Theming

Colors can be associated using the existing support for theming and color customization in VSCode.  Documentation on Theming in VS Code can be found <a HREF="https://code.visualstudio.com/docs/getstarted/themes">here</a>.

Colors are associated with <a HREF="https://macromates.com/manual/en/language_grammars#naming_conventions">TextMate scopes</a>.


# All IntelliSense Tokens and Scopes


| Token         | Scope         |
| ------------- |:-------------:|
| Class Template | entity.name.class.template |
| Comment | comment |
| Enumerator | variable.other.enummember |
| Event  (C++/CLI) | variable.other.event |
| Function | entity.name.function |
| Function Template | entity.name.function.template |
| Generic Type (C++/CLI) | entity.name.class.generic |
| Global Variable | variable.other.global |
| Identifier | <span>entity.name</span> |
| Keyword | keyword.control |
| Label | entity.name.label |
| Local Variable | variable.other.local |
| Macro | entity.name.function.preprocessor |
| Member Field  | variable.other.member |
| Member Function | entity.name.function.member |
| Member Operator | keyword.operator.member |
| Namespace | entity.name.namespace |
| NewDelete | keyword.operator.new |
| Number Literal | constant.numeric |
| Operator | keyword.operator |
| Operator Function | entity.name.function.operator |
| Parameter | variable.parameter |
| Preprocessor Keyword | keyword.control.directive |
| Property (C++/CLI) | variable.other.property |
| Reference Type (C++/CLI) | entity.name.class.reference |
| Static Member Field | variable.other.member.static |
| Static Member Function | entity.name.function.member.static |
| String Literal | string.quoted |
| Type | entity.name.type |
| User-Defined Literal – Number | entity.name.user-defined-literal.number |
| User-Defined Literal - Raw | entity.name.user-defined-literal |
| User-Defined Literal - String | entity.name.user-defined-literal.string |
| Value Type (C++/CLI) | entity.name.class.value |
| Variable | variable |
| Xml Doc Comment | comment.xml.doc |
| Xml Doc Tag | comment.xml.doc.tag |

Many of the tokens recognized by IntelliSense do not directly map to existing scopes in the VSCode's default C/C++ TextMate grammar, so are likely not colored by existing VSCode themes.

# Customizing Colors in Settings

Colors can also be overridden globally, in settings:
```
    "editor.tokenColorCustomizations": {
        "textMateRules": [
            {
                "scope": "entity.name.type",
                "settings": {
                    "foreground": "#FF0000",
                    "fontStyle": "italic bold underline"
                }
            }
        ]
    }
```
Or, overridden on a per-theme basis:
```
    "editor.tokenColorCustomizations": {
        "[Visual Studio Dark]": {
            "textMateRules": [
                {
                    "scope": "entity.name.type",
                    "settings": {
                        "foreground": "#FF0000",
                        "fontStyle": "italic bold underline"
                    }
                }
            ]    
        }
```
