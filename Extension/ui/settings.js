const field = {
    CompilerPath: 'compilerPath',
    IntelliSenseMode: 'intelliSenseMode', 
    IncludePath: 'includePath',
    Defines: 'defines',
    cStandard: 'cStandard',
    cppStandard: 'cppStandard'
}
    const vscode = acquireVsCodeApi();

    window.addEventListener('message', event => {
        const message = event.data; // The json data that the extension sent
        switch (message.command) {
            case 'setDefault':
            document.getElementById("demo").innerHTML = "setDefault";
                break;
        }
    })

    document.getElementById(field.CompilerPath).addEventListener("change", myFunctionCompiler);
    document.getElementById(field.IncludePath).addEventListener("change", myFunctionField);
    document.getElementById(field.cStandard).addEventListener("change", myFunction(field.cStandard));
    document.getElementById(field.cppStandard).addEventListener("change", myFunction(field.cppStandard));

    function myFunction(field) {
        console.log(field);
        var y = document.getElementById(field);
        console.log(y);
        vscode.postMessage({
            command: "alert",
            text: "selected: " + y.value
        });
    }

    function myFunctionField() {
        var y = document.getElementById("includePath");


        vscode.postMessage({
            command: "alert",
            text: "includePath " + y.value
        });
    }

    function myFunctionCompiler() {
        var y = document.getElementById("compilerPath");

        vscode.postMessage({
            command: "alert",
            text: "compilerPath " + y.value
        });
    }
