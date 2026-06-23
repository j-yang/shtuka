This directory is bundled into the app as resources. The CI release workflow
drops the platform-specific pdfium library here before building:

  - Windows: pdfium.dll
  - Linux:   libpdfium.so
  - macOS:   libpdfium.dylib

At runtime the app sets PDFIUM_LIB_PATH to the resolved resource directory so
pdfium loads from here (see src/lib.rs setup). For local Windows builds you can
also just keep pdfium.dll next to the exe (dist-windows/), which still works.
