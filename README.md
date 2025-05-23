# Curve Editor

A web-based browser-only application for creating and editing curves simple curves.

It can be used here: [Curve Editor](https://florenzen.githuib.io/curve-editor)

## Features

*   **Multiple Curve Types:** Supports various curve interpolations:
    *   Spline (Quadratic Bezier)
    *   Step
    *   Natural Spline (Catmull-Rom)
    *   Natural Cubic Spline
*   **Interactive Canvas:** Click to add points and drag to move points on the canvas.
*   **File Operations:**
    *   **Load Graph:** Load curve data from a JSON file for further manipulation.
    *   **Download Graph:** Save the current curve data as a JSON file.
    *   **Download CSV:** Export the curve points as a CSV file.

## How to Use

1.  Open `src/index.html` in your web browser.
2.  **Adding Points:** Double-click on the canvas to add an anchor point.
3.  **Moving Points:** Click and drag an existing point to change its position.
4.  **Removing Points:** Double-clock on a point to remove it.
5.  Use the controls on the left panel to:
    *   Select the desired curve type.
    *   Update the X-axis maximum.
    *   Adjust zoom levels for X and Y axes.
    *   Load or save your work.

## Project Structure

*   `src/index.html`: The main HTML file for the application.
*   `src/style.css`: Contains the styles for the application.
*   `src/script.js`: Handles the logic for curve drawing, interactions, and controls.
*   `notebooks/`: Contains Jupyter notebooks (if any, for development or exploration).

## Development

To contribute or modify the project:

1.  Clone the repository.
2.  Open `src/index.html` in a browser to run the application.
3.  Modify the files in the `src/` directory as needed.
