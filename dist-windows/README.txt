shtuka — Windows build
=======================

Files:
  shtuka.exe          The application (self-contained; React UI is embedded).
  WebView2Loader.dll  Required loader for the WebView2 runtime.
  pdfium.dll          PDF engine, loaded at runtime for fast PDF text diffing.

To run:
  Keep shtuka.exe, WebView2Loader.dll and pdfium.dll in the SAME folder, then
  double-click shtuka.exe. (pdfium.dll is only needed when diffing PDFs; if it
  is missing, PDF diffs report a clear error and other formats still work.)

Requirements:
  Windows 10/11 with the Microsoft Edge WebView2 Runtime. This ships with all
  current Windows installs; if missing, get the Evergreen Runtime from
  https://developer.microsoft.com/microsoft-edge/webview2/

Built by cross-compiling from WSL with the llvm-mingw toolchain
(target x86_64-pc-windows-gnullvm, static CRT). The exe has no dependencies
beyond standard Windows system DLLs and WebView2.
