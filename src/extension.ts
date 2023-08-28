// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
const axios = require("axios").default;
const path = require("path");
const fs = require("fs");
import { v4 as uuidv4 } from "uuid"; 

import { loginCursor } from "./auth";

type ResponseType =
  | "idk"
  | "freeform"
  | "generate"
  | "edit"
  | "chat_edit"
  | "lsp_edit";

interface CodeBlock {
  fileId: number;
  text: string;
  startLine: number;
  endLine: number;
}

type CodeSymbolType = "import" | "function" | "class" | "variable";
interface CodeSymbol {
  fileName: string;
  name: string;
  type: CodeSymbolType;
}

interface UserMessage {
  sender: "user";
  conversationId: string;
  message: string;
  msgType: ResponseType;
  sentAt: number;
  currentFile: string | null;
  precedingCode: string | null;
  procedingCode: string | null;
  currentSelection: string | null;
  // Other pieces of info encoded
  otherCodeBlocks: CodeBlock[];
  codeSymbols: CodeSymbol[];
  selection: { from: number; to: number } | null;
  maxOrigLine?: number;
}
interface ChatMessage {
  question: string;
  answer: string;
}

type BotMessageType =
  | "edit"
  | "continue"
  | "markdown"
  | "multifile"
  | "location"
  | "interrupt"
  | "chat_edit"
  | "lsp_edit";

interface BotMessage {
  sender: "bot";
  sentAt: number;
  type: BotMessageType;
  conversationId: string;
  message: string;
  currentFile: string | null;
  lastToken: string;
  finished: boolean;
  interrupted: boolean;
  rejected?: boolean;
  hitTokenLimit?: boolean;
  maxOrigLine?: number;
  useDiagnostics?: boolean | number;
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log('Congratulations, your extension "demo" is now active!');

  // The command has been defined in the package.json file
  // Now provide the implementation of the command with registerCommand
  // The commandId parameter must match the command field in package.json

  const provider = new CursorWebviewViewProvider(
    context.extensionUri,
    context.extensionPath
  );

  const curosrDispose = vscode.window.registerWebviewViewProvider(
    "cursorcode.chatView",
    provider,
    {
      webviewOptions: { retainContextWhenHidden: true },
    }
  );

  const generationDispose = vscode.commands.registerTextEditorCommand(
    "cursorcode.generation",
    (editor: vscode.TextEditor) => {
      // console.log(editor);
      vscode.window
        .showInputBox({
          prompt: "请输入您的需求",
          placeHolder: "例如：生成一个加密算法...",
        })
        .then((value) => {
          const selected = editor.document.getText(editor.selection);
          if (selected) {
            provider.msgType = "edit";
          } else {
            provider.msgType = "generate";
          }
          if (value) {
            provider.message = value!;
            provider.test();
            // console.log(value);
          }
        });
    }
  );

  const conversationDispose = vscode.commands.registerTextEditorCommand(
    "cursorcode.conversation",
    (editor: vscode.TextEditor) => {
      // console.log(editor);
      vscode.commands.executeCommand("cursorcode.chatView.focus");
      vscode.window
        .showInputBox({
          prompt: "请输入您的问题？",
          placeHolder: "例如：帮我帮我生成一个加密算法...",
        })
        .then((value) => {
          provider.msgType = "freeform";
          if (value) {
            provider.message = value!;
            // provider.conversation();
            provider.chat();
            // console.log(value);
          }
        });
    }
  );

  context.subscriptions.push(
    generationDispose,
    curosrDispose,
    conversationDispose,
  );

}

class CursorWebviewViewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;

  private url: string = "http://219.143.38.36:80/generate";
  private chaturl: string = "http://13.66.215.2:8006/";
  public message: string = "";
  public chatHistorys: ChatMessage[] = [];
  public msgType: ResponseType = "freeform";
  private contextType: string = 'copilot';

  private accessToken: string = '';

  public pasteOnClick: boolean = true;
  public keepConversation: boolean = true;

  public userMessages: UserMessage[] = [];
  public botMessages: BotMessage[] = [];
  public conversationId: string = "";

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly extensionPath: string
  ) {
    // 获取配置项
    const config = vscode.workspace.getConfiguration('cursorcode');
    // 获取配置项中的文本
    const cursorToken:string = config.get('accessToken') as string;
    // 显示文本
    this.accessToken = cursorToken;
    // console.log(cursorToken)
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    // set options for the webview
    webviewView.webview.options = {
      // Allow scripts in the webview
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    // set the HTML for the webview
    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // add an event listener for messages received by the webview
    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case "codeSelected": {
          // do nothing if the pasteOnClick option is disabled
          if (!this.pasteOnClick) {
            break;
          }

          let code = data.value;
          code = code.replace(/([^\\])(\$)([^{0-9])/g, "$1\\$$$3");

          // insert the code as a snippet into the active text editor
          vscode.window.activeTextEditor?.insertSnippet(
            new vscode.SnippetString(code)
          );
          break;
        }
        case "prompt": {
          this.msgType = "freeform";
          this.message = data.value;
          this.chat();
          break
        }
        case "clear": {
          console.log("clear");   
          this.userMessages = [];
          this.botMessages = [];
          this.chatHistorys = [];
          this.conversationId = "";
          break
        }
        case "loginCursor": {
          const loginData: any = await loginCursor()
          if(loginData){
            this.accessToken = loginData.accessToken;
             // 获取配置项
            const config = vscode.workspace.getConfiguration('cursorcode');
            // 将文本保存到配置项里面
            config.update('accessToken', loginData.accessToken, vscode.ConfigurationTarget.Global);
            config.update('refreshToken', loginData.refreshToken, vscode.ConfigurationTarget.Global);
            config.update('challenge', loginData.challenge, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage("登录成功");
          }else {
            vscode.window.showInformationMessage("登录失败");
          }
          break
        }
      }
    });
  }

  /**
   * 获取请求体数据
   * @returns 请求体数据
   */
  public getPayload() {
    const editor = vscode.window.activeTextEditor!;
    if (!editor) {
      vscode.window.showWarningMessage(
        "CursorCode：对话前请先打开一个代码文件!"
      );
      return false;
    }
    const selection = editor.selection;

    // Split the `precedingCode` into chunks of 20 line blocks called `precedingCodeBlocks`
    const blockSize = 20;

    let precedingCodeBlocks = [];
    // 获取选中代码的上文代码
    const precedingCode = editor.document.getText(
      new vscode.Range(new vscode.Position(0, 0), selection.start)
    );
    if (precedingCode) {
      let precedingCodeLines = precedingCode.split("\n");
      for (let i = 0; i < precedingCodeLines.length; i += blockSize) {
        let block = precedingCodeLines.slice(i, i + blockSize);
        precedingCodeBlocks.push(block.join("\n"));
      }
    }

    // Split the `procedingCodeBlocks` into chunks of 20 line blocks called `procedingCodeBlocks`
    let procedingCodeBlocks = [];
    const endLine = editor.document.lineCount - 1;
    const endLineLen = editor.document.lineAt(new vscode.Position(endLine, 0))
      .text.length;
    // 获取选中代码的下文代码
    const procedingCode = editor?.document.getText(
      new vscode.Range(selection.end, new vscode.Position(endLine, endLineLen))
    );
    if (procedingCode) {
      let procedingCodeLines = procedingCode.split("\n");
      for (let i = 0; i < procedingCodeLines.length; i += blockSize) {
        let block = procedingCodeLines.slice(i, i + blockSize);
        procedingCodeBlocks.push(block.join("\n"));
      }
    }

    const filePath = editor.document.fileName;
    const rootPath = path.dirname(filePath);

    const userRequest = {
      // Core request
      message: this.message,
      // Context of the current file
      currentRootPath: rootPath,
      currentFileName: filePath,
      currentFileContents: editor.document.getText(),
      // Context surrounding the cursor position
      precedingCode: precedingCodeBlocks,
      currentSelection:
        editor.document.getText(selection) == ""
          ? null
          : editor.document.getText(selection) ?? null,
      suffixCode: procedingCodeBlocks,
      // Get Copilot values
      copilotCodeBlocks: [],
      // Get user defined values
      customCodeBlocks: [],
      codeBlockIdentifiers: [],
      msgType: this.msgType,
      // Messy, but needed for the single lsp stuff to work
      maxOrigLine: null,
      diagnostics: null,
    };
    const userMessages = [
      ...this.userMessages
        .filter((um: any) => um.conversationId == this.conversationId)
        .slice(0, -1),
    ];
    const botMessages = [
      ...this.botMessages.filter(
        (bm: any) => bm.conversationId == this.conversationId
      ),
    ];
    const data = {
      userRequest,
      userMessages: this.msgType === "freeform" ? userMessages : [],

      botMessages: this.msgType === "freeform" ? botMessages : [],
      //useFour: state.settingsState.settings.useFour === 'enabled',
      contextType: this.contextType,

      rootPath: rootPath,

      // apiKey: null
    };

    // console.log(data);
    return data;
  }


    /**
   * 代码生成
   * @returns 请求体数据
   */
  public async test() {
    let prompt = "Below is an instruction that describes a task. Write a response that appropriately completes the request.\n### Instruction:\n"+this.message+"\n### Response:";

    vscode.window.showInformationMessage("加载中....");
    let response;
    response =await axios.post(this.url, 
    {
      "inputs": "Below is an instruction that describes a task. Write a response that appropriately completes the request.\n### Instruction:\n"+this.message+".\n### Response:",
      "parameters":{"max_new_tokens":1024,"top_k":40,"top_p":0.9,"temperature":1}
    },
    // {
    //   // prompt: "<|system|>\n<|end|>\n<|user|>\n"+this.message+"<|end|>\n<|assistant|>",
    //   // prompt: "Below is an instruction that describes a task. Write a response that appropriately completes the request."+this.message,
     
    //   inputs: prompt,
    //   parameters: {max_tokens: 1024,
    //     top_p:0.9,
    //     top_k: 40,
    //     temperature:1}
    // },
    {
      headers: {
        'Content-Type': 'application/json',
        'Accept': '*/*"'
      },
      timeout: 50000
    }).catch((error: any) => {
      console.log(error);
      vscode.window.showInformationMessage("这个问题暂时还不能回答");
      return;
    });
    console.log(prompt);
    console.log(response);
    this.newstreamSource(response.data.generated_text);
  }
  //代码生成请求结果处理
  newstreamSource(stream: any) {
    //解析stream
    let isMsg = false;
    let content = "";
    let newContent = "";
    let isInterrupt = false;
    console.log(stream);
    let arr = stream.split("```");
    if(arr.length>1){
      if(arr[1].split("```")[0]){
        stream = arr[1].split("```")[0];
        arr = stream.split("fortran");
        if(arr.length>1){
          stream = arr[1];
        }
        
      }else{
        vscode.window.showInformationMessage("服务器开小差，请稍后重试");
        return;
      }
    }else{
      vscode.window.showInformationMessage("服务器开小差，请稍后重试");
      return;
    }
    // const lines = stream.split("\n");
    const editor = vscode.window.activeTextEditor!;
    const document = editor.document;
       const selection = editor.selection;
       vscode.window.showInformationMessage("生成成功");
       editor.insertSnippet(new vscode.SnippetString(stream));
    
  }  
  




// 处理chat数据
  chatDataSource(data: any) {
    
    data.replace(/```\w:.*?\.(\w+)/g, "```$1\n")
    data.replace("\r\n", "\n")
    let arr = data.split("<|endoftext|>");
    if(arr.length>1){
      data = arr[0];
    }
      this._view?.webview.postMessage({
        type: "addAnswer",
        value: data,
      });
      this._view?.webview.postMessage({
        type: "showInput",
        value: null,
      });
  }  
  //处理chat历史问答，每次请求完添加到历史数组里
  chatHistorysSource(answer: any,message: any) {
    const newChatMessage: ChatMessage = {
      question: message,
      answer: answer,
    
    };
    this.chatHistorys.push(newChatMessage);
  } 

  //chat请求
  public async chat(){
    if (!this._view) {
      vscode.commands.executeCommand("cursorcode.chatView.focus");
    } else {
      this._view?.show?.(true);
    }
    this._view?.webview.postMessage({
      type: "addQuestion",
      value: this.message,
      msgType: this.msgType,
      fileName: vscode.window.activeTextEditor?.document.fileName,
    });
    var data = JSON.stringify(this.chatHistorys);
    
    var config = {
      method: 'post',
      url: this.chaturl+'chat/query?query='+this.message,
      headers: { 
        'Content-Type': 'application/json'
      },
      data : data,
    };
    let startTime = process.hrtime();

    let timer = setTimeout((response) => {
      if (response != undefined) {
        console.log("Variable has a value");
        console.log(response);
      } else {
        console.log(response);

        this._view?.webview.postMessage({
          type: "addAnswer",
          value: "当前请求时间稍长，请等待或点击下方\"停止响应\"按钮后重新查询",
        });
        return;
      }
    }, 20000); // 20 seconds in milliseconds

    axios(config)
    .then((response:any) => {
        let endTime = process.hrtime(startTime);
        let responseTime = endTime[0] * 1000 + endTime[1] / 1000000;
        console.log(`Response time: ${responseTime} milliseconds`);
        console.log(response.data);
        if(response.status == 200){
          this.chatDataSource(response.data)
          this.chatHistorysSource(response.data,this.message);
          return;
        }else{
          this._view?.webview.postMessage({
            type: "showInput",
            value: "服务器开小差，请稍后重试",
          });
        }
      });
  }


  
  
    /**
   * 代码生成
   * @returns 请求体数据
   */
  public async conversation() {
    const payload = this.getPayload();
    if (!payload) {
      return;
    }
    debugger
    // focus gpt activity from activity bar
    if (!this._view) {
      await vscode.commands.executeCommand("cursorcode.chatView.focus");
    } else {
      this._view?.show?.(true);
    }

    this._view?.webview.postMessage({
      type: "addQuestion",
      value: this.message,
      msgType: this.msgType,
      fileName: vscode.window.activeTextEditor?.document.fileName,
    });

    var reqData = {
      method: "POST",
      url: this.url + "engines/codegen/completions",
      // url: "http://192.168.0.114:8000/chat?query=" + this.message,
      headers: {
        "accept-language": "zh-CN",
        "content-type": "application/json",
        authorization: '',
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Cursor/0.2.0 Chrome/108.0.5359.62 Electron/22.0.0 Safari/537.36",
        Authorization: "Bearer " + this.accessToken,
      },
      data: payload,
      responseType: "stream",
    };
    let response;
    try {
      response = await axios.request(reqData);
      console.log(response);
    } catch (e: any) {
      if (e.response.status==401) {
        this._view?.webview.postMessage({
          type: "showInput",
          value: "请先点击上方的登录按钮进行登录后使用",
        });
        return;
      }
      // this._view?.webview.postMessage({
      //   type: "showInput",
      //   value: "使用超出上限，请重试，如果还是不行，请稍等几分钟重试...",
      // });
      this._view?.webview.postMessage({
        type: "showInput",
        value: "出错啦，" + e.response.statusText,
      });
      return;

    }
    const stream = response.data;
    this.streamSource(stream);
  }

  public async continue(answer: string) {
    const payload = this.getPayload();
    if (!payload) {
      return;
    }

    const newBotMessage: BotMessage = {
      sender: "bot",
      sentAt: Date.now(),
      type: "edit",
      conversationId: uuidv4(),
      lastToken: "",
      message: answer,
      finished: false,
      currentFile: payload.userRequest.currentFileName,
      interrupted: true,
      // hitTokenLimit: true,
      // maxOrigLine: vscode.window.activeTextEditor?.document.lineCount! - 1,
    };
    payload.botMessages.push(newBotMessage);

    // console.log(payload);

    // focus gpt activity from activity bar
    if (!this._view) {
      await vscode.commands.executeCommand("cursorcode.chatView.focus");
    } else {
      this._view?.show?.(true);
    }

    this._view?.webview.postMessage({
      type: "addQuestion",
      value: this.message,
      msgType: this.msgType,
      fileName: vscode.window.activeTextEditor?.document.fileName,
    });

    var reqData = {
      method: "POST",
      url: this.url + "/continue/",
      headers: {
        "accept-language": "zh-CN",
        "content-type": "application/json",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Cursor/0.1.0 Chrome/108.0.5359.62 Electron/22.0.0 Safari/537.36",
      },
      data: payload,
      responseType: "stream",
    }; 
    let response;
    try {
      response = await axios.request(reqData);
    } catch (e) {
      console.log(response);
      console.log(e);
      this._view?.webview.postMessage({
        type: "showInput",
        value: "使用超出上限，请重试，如果还是不行，请稍等几分钟重试...",
      });
      return;
    }
    const stream = response.data;
    this.streamSource(stream, true);
  }

  /**
   * 解析stream
   * @param stream 数据流
   */
  private streamSource(stream: any, isContinue: boolean = false) {
    //解析stream
    let isMsg = isContinue;
    let content = "";
    let newContent = "";
    let isInterrupt = false;
    debugger
    stream.on("data", (data: any) => {
      data = data.toString();
      debugger
      // console.log(data);
      const lines = data.split("\n");
      // 在编辑器光标处插入代码
      for (let line of lines) {
        if (line.startsWith("data: ")) {
          let jsonString = line.slice(6);
          // console.log(jsonString);
          if (jsonString == "[DONE]") {
            this._view?.webview.postMessage({
              type: "showInput",
              value: null,
            });
            return console.log("done");
          }
          if (jsonString.indexOf("BEGIN_message") != -1) {
            jsonString = jsonString.split("|>")[1] ?? "";
            isMsg = true;
          }
          if (jsonString.indexOf("END_message") != -1) {
            jsonString = jsonString.split("<|")[0];
            // 对话式才计如上下文
            if (this.msgType == "freeform") {
              this.manufacturedConversation(this.message, content);
            }
            isMsg = false;
          }
          if (jsonString.indexOf("<|END_interrupt|>") != -1) {
            jsonString = jsonString.replace("<|END_interrupt|>", "");
            isInterrupt = true;
          }

          if (isMsg) {
            try {
              if (jsonString != '"') {
                content += JSON.parse(jsonString);
              } else {
                continue;
              }
            } catch (e) {
              console.log("出错了", jsonString);
              this._view?.webview.postMessage({
                type: "showInput",
                value: "出错啦，请重试...",
              });
              return;
            }

            // Replace all occurrences of "/path/to/file.extension\n" with "file.extension\n"
            const replacePathWithFilename = (text: string) => {
              return text.replace(/```\w:.*?\.(\w+)/g, "```$1\n");
            };

            const replaceRN = (text: string) => {
              return text.replace("\r\n", "\n");
            };

            // console.log(replacePathWithFilename(content))
            newContent = replacePathWithFilename(replaceRN(content));

            this._view?.webview.postMessage({
              type: "addAnswer",
              value: newContent,
            });
          }
        }
      }
    });

    stream.on("end", () => {
      // if (content.length < 5) {
      //   this._view?.webview.postMessage({
      //     type: "showInput",
      //     value: "出错啦，请重试...",
      //   });
      //   console.error("异常断开");
      //   return;
      // }
      if(isInterrupt) {
        // console.log(newContent)
        // this.continue(newContent);
        return;
      }
    });

    stream.on("error", (err: any) => {
      this._view?.webview.postMessage({
        type: "showInput",
        value: "出错啦，请重试...",
      });
      console.error("异常断开");
      return;
    });
  }

  public manufacturedConversation(question: any, answer: string) {
    if (this.conversationId == "") {
      this.conversationId = uuidv4();
    }

    const editor = vscode.window.activeTextEditor!;
    const selection = editor.selection;

    // 获取选中代码的上文代码
    const precedingCode = editor.document.getText(
      new vscode.Range(new vscode.Position(0, 0), selection.start)
    );
    const endLine = editor.document.lineCount - 1;
    const endLineLen = editor.document.lineAt(new vscode.Position(endLine, 0))
      .text.length;
    // 获取选中代码的下文代码
    const procedingCode = editor?.document.getText(
      new vscode.Range(selection.end, new vscode.Position(endLine, endLineLen))
    );

    const newUserMessage: UserMessage = {
      sender: "user",
      sentAt: Date.now(),
      message: question,
      conversationId: this.conversationId,
      otherCodeBlocks: [],
      codeSymbols: [],
      currentFile: editor.document.fileName ?? null,
      precedingCode: precedingCode ?? null,
      procedingCode: procedingCode ?? null,
      currentSelection: editor.document.getText(editor.selection) ?? null,
      // maxOrigLine: null,
      selection: null,
      msgType: "freeform",
    };

    this.userMessages.push(newUserMessage);

    const newBotMessage: BotMessage = {
      sender: "bot",
      sentAt: Date.now(),
      type: "markdown",
      conversationId: this.conversationId,
      lastToken: "",
      message: answer,
      finished: true,
      currentFile: null,
      interrupted: false,
      // maxOrigLine: null,
    };

    this.botMessages.push(newBotMessage);
    // Ready for another message in this conversation
    // chatState.draftMessages[newConversationId] = {
    //   ...newUserMessage,
    //   message: "",
    // };
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "main.js")
    );
    const tailwindUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this._extensionUri,
        "media",
        "scripts",
        "tailwind.min.js"
      )
    );
    const markeddUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this._extensionUri,
        "media",
        "scripts",
        "marked.min.js"
      )
    );
    const highlightUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this._extensionUri,
        "media",
        "scripts",
        "highlight.min.js"
      )
    );
    const highlighDefualtUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this._extensionUri,
        "media",
        "css",
        "highligh.style.css"
      )
    );
    const leftSideStyleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this._extensionUri,
        "media",
        "css",
        "leftSideStyle.css"
      )
    );

    // const filePath = path.join(this.extensionPath, 'resources', 'read.md');
    // const readMe = fs.readFileSync(filePath, 'utf8');
    // console.log(readMe)

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">

      <script src="${tailwindUri}"></script>
      <script src="${highlightUri}"></script>
      <script src="${markeddUri}"></script>
      <link rel="stylesheet" href="${highlighDefualtUri}">
      <link rel="stylesheet" href="${leftSideStyleUri}">
    </head>
    <body>
      <div id="read-box">
        <p style="font-size: 1.6em">欢迎使用</p>
      </div>

      <div id="chat-box" class="pt-6 text-sm">请输入你的问题：</div>
      <div class="response-box"><button id="stop-response">停止响应</button></div>
      <div style="height: 80px;"></div>

      <div id="bottom-box">
        <button id="clear-msg">清除会话</button>
        <input class="h-10 w-full p-4 text-sm" type="text" id="prompt-input" placeholder="请输入你的问题..."/>
      </div>
    </body>
    <script src="${scriptUri}"></script>
    </html>`;
  }
}

// This method is called when your extension is deactivated
export function deactivate() {}
