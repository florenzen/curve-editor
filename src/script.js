// MIT License
//
// Copyright (c) 2025 Florian Lorenzen
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

document.addEventListener('DOMContentLoaded', () => {
    // Get DOM elements
    const canvas = document.getElementById('curve-canvas');
    const ctx = canvas.getContext('2d');
    const curveTypeSelect = document.getElementById('curve-type');

    // New DOM elements for coordinate system
    const xMaxInput = document.getElementById('x-max');
    const updateCoordsButton = document.getElementById('update-coords');
    const yZoomSlider = document.getElementById('y-zoom');
    const yZoomValueDisplay = document.getElementById('y-zoom-value');
    const xZoomSlider = document.getElementById('x-zoom');
    const xZoomValueDisplay = document.getElementById('x-zoom-value');
    const resetViewButton = document.getElementById('reset-view');

    // File operation DOM elements
    const loadFileInput = document.getElementById('load-file-input');
    const loadGraphButton = document.getElementById('load-graph-button');
    const downloadGraphButton = document.getElementById('download-graph-button');
    const downloadCsvButton = document.getElementById('download-csv-button'); // CSV Button
    const filenameInput = document.getElementById('filename-input'); // Filename input field

    // Application state
    let currentCurveType = 'spline'; // 'spline' or 'step'
    let points = []; // Array to store curve points {x: worldX, y: worldY}
    let selectedPointIndex = -1; // Index of the selected point, -1 if none
    let isDraggingPoint = false; // For dragging existing points
    let draggingSegmentIndex = -1; // For step curve segment dragging (index of start point of segment)
    let dragPointType = null; // 'anchor', 'control'

    // Hover state
    let hoveredPointIndex = -1;
    let hoveredSegmentIndex = -1; // For step curve segments
    let hoveredSplineSegmentIndex = -1; // For spline curve segments (index of the first anchor)
    let hoveredNaturalSegmentIndex = -1; // For natural spline segments
    let hoveredNaturalCubicSegmentIndex = -1; // For natural cubic spline segments

    // Drag readout state
    let dragReadoutInfo = null; // { text: string, x: canvasX, y: canvasY }

    // Coordinate system state
    let xMax = 100;
    const padding = 50; // Canvas padding for axes and labels

    // Viewport state
    let yViewCenter = 0; // Default for initial spline view
    let yZoomFactor = 1;
    let baseVisibleYRange = 2000; // Default for initial spline view (-1000 to 1000)

    let xViewCenter = xMax / 2;
    let xZoomFactor = 1;

    // Panning state
    let isPanningY = false;
    let panStartY_canvas = 0;
    let panStart_yViewCenter = 0;

    let isPanningX = false;
    let panStartX_canvas = 0;
    let panStart_xViewCenter = 0;

    // C1 continuity state for control point dragging
    let linkedPartnersInfo = []; // Array to store info for potentially two linked partners

    // State for dragging an anchor point and maintaining C1 continuity for its control points
    let draggedAnchorInfo = null; // { type: 'intermediate'|'start'|'end', c_before_offset?: {dx,dy}, c_after_offset?: {dx,dy} }

    // Helper function to get sampled Y at a given X for the current curve
    function getSampledYatX(targetX, curveType, pointsArray) {
        if (pointsArray.length === 0) {
            return getDefaultY(); // Or some other default like 0 or NaN
        }

        const sortedPoints = [...pointsArray].sort((a, b) => a.x - b.x);

        if (curveType === 'step') {
            // For step curves, find the segment targetX falls into
            // The Y value is taken from the point that starts the segment
            if (targetX < sortedPoints[0].x) return sortedPoints[0].y; // Before first point
            for (let i = 0; i < sortedPoints.length - 1; i++) {
                if (targetX >= sortedPoints[i].x && targetX < sortedPoints[i + 1].x) {
                    return sortedPoints[i].y;
                }
            }
            return sortedPoints[sortedPoints.length - 1].y; // After or at last point
        } else if (curveType === 'spline') { // THIS IS THE CORRECTED BLOCK
            if (pointsArray.length < 3) return getDefaultY(); // Need at least A0, C0, A1

            // Find which Bezier segment targetX falls into or is closest to.
            // A segment is A_i, C_i, A_(i+1) which are points[2j], points[2j+1], points[2j+2]
            for (let j = 0; j < pointsArray.length - 2; j += 2) {
                const p0 = pointsArray[j];
                const c0 = pointsArray[j + 1];
                const p1 = pointsArray[j + 2];

                if (!p0 || !c0 || !p1 || p0.type !== 'anchor' || c0.type !== 'control' || p1.type !== 'anchor') {
                    continue; // Skip invalid segments
                }

                // Check if targetX is within this segment's X range (p0.x to p1.x)
                // Note: p0.x might be greater than p1.x if control points are dragged freely.
                // For sampling, we assume an ordered progression along X for simplicity of finding the segment.
                // If X values are not ordered, this segment finding logic is insufficient.
                // We should ensure anchor points x are generally increasing (enforced by drag constraints mostly)
                // const xMinSeg = Math.min(p0.x, p1.x); // Not strictly needed if p0.x <= p1.x for sampling
                // const xMaxSeg = Math.max(p0.x, p1.x);

                if (targetX >= p0.x && targetX <= p1.x) { // Primary check: targetX within segment P0.x and P1.x
                    // Solve for t where x(t) = targetX, or iterate t
                    // Iterative approach for sampling:
                    const numSteps = 100; // Number of steps to check along the curve
                    for (let k = 0; k <= numSteps; k++) {
                        const t = k / numSteps;
                        const one_minus_t = 1 - t;

                        const x_t = one_minus_t * one_minus_t * p0.x +
                            2 * one_minus_t * t * c0.x +
                            t * t * p1.x;

                        if (Math.round(x_t) === Math.round(targetX)) {
                            const y_t = one_minus_t * one_minus_t * p0.y +
                                2 * one_minus_t * t * c0.y +
                                t * t * p1.y;
                            return y_t; // Found Y for targetX
                        }
                    }
                    // If exact match not found by iteration (e.g. due to rounding or sparse x values on curve)
                    // fall back to linear interpolation for this segment, or y of closest anchor.
                    if (p0.x === p1.x) return p0.y; // Vertical, return start y
                    const y_lerp = p0.y + (targetX - p0.x) * (p1.y - p0.y) / (p1.x - p0.x);
                    return y_lerp; // Fallback
                }
            }
            // If targetX is outside all defined spline segments, clamp to the start/end anchor Y.
            if (targetX <= pointsArray[0].x) return pointsArray[0].y;
            if (targetX >= pointsArray[pointsArray.length - 1].x) return pointsArray[pointsArray.length - 1].y;

            // If no segment strictly contained targetX (e.g., due to unordered X anchors or gaps)
            // this is a fallback. Ideally, segments cover the whole 0-xMax.
            return getDefaultY();
        } else if (curveType === 'natural') {
            if (sortedPoints.length === 0) return getDefaultY();
            if (sortedPoints.length === 1) return sortedPoints[0].y; // Single point, return its Y

            // Handle out-of-bounds targetX by clamping to the Y of the first/last point
            if (targetX <= sortedPoints[0].x) return sortedPoints[0].y;
            if (targetX >= sortedPoints[sortedPoints.length - 1].x) return sortedPoints[sortedPoints.length - 1].y;

            if (sortedPoints.length === 2) { // Straight line for 2 points
                const p_start = sortedPoints[0];
                const p_end = sortedPoints[1];
                if (p_end.x === p_start.x) return p_start.y; // Vertical line
                return p_start.y + (targetX - p_start.x) * (p_end.y - p_start.y) / (p_end.x - p_start.x);
            }

            // Catmull-Rom sampling for 3+ points
            for (let i = 0; i < sortedPoints.length - 1; i++) {
                let p0_cr, p1_cr, p2_cr, p3_cr; // These are the Catmull-Rom points

                p1_cr = sortedPoints[i];     // Current segment start
                p2_cr = sortedPoints[i + 1];   // Current segment end

                if (!((targetX >= p1_cr.x && targetX <= p2_cr.x) || (targetX >= p2_cr.x && targetX <= p1_cr.x))) {
                    continue;
                }

                if (i === 0) {
                    p0_cr = p1_cr;
                } else {
                    p0_cr = sortedPoints[i - 1];
                }

                if (i === sortedPoints.length - 2) {
                    p3_cr = p2_cr;
                } else {
                    p3_cr = sortedPoints[i + 2];
                }

                const b0_x = p1_cr.x;
                const b0_y = p1_cr.y;
                const b3_x = p2_cr.x;
                const b3_y = p2_cr.y;

                const b1_x = p1_cr.x + (p2_cr.x - p0_cr.x) / 6;
                const b1_y = p1_cr.y + (p2_cr.y - p0_cr.y) / 6;
                const b2_x = p2_cr.x - (p3_cr.x - p1_cr.x) / 6;
                const b2_y = p2_cr.y - (p3_cr.y - p1_cr.y) / 6;

                const numSteps = 100;
                for (let k = 0; k <= numSteps; k++) {
                    const t = k / numSteps;
                    const omt = 1 - t;

                    const x_t = omt * omt * omt * b0_x +
                        3 * omt * omt * t * b1_x +
                        3 * omt * t * t * b2_x +
                        t * t * t * b3_x;

                    if (Math.abs(x_t - targetX) < 0.5) {
                        const y_t = omt * omt * omt * b0_y +
                            3 * omt * omt * t * b1_y +
                            3 * omt * t * t * b2_y +
                            t * t * t * b3_y;
                        return y_t;
                    }
                }
                if (p1_cr.x === p2_cr.x) return p1_cr.y;
                const y_lerp = p1_cr.y + (targetX - p1_cr.x) * (p2_cr.y - p1_cr.y) / (p2_cr.x - p1_cr.x);
                return y_lerp;
            }
            return getDefaultY();
        } else if (curveType === 'naturalCubic') {
            if (sortedPoints.length === 0) return getDefaultY();
            if (sortedPoints.length === 1) return sortedPoints[0].y;

            if (targetX <= sortedPoints[0].x) return sortedPoints[0].y;
            if (targetX >= sortedPoints[sortedPoints.length - 1].x) return sortedPoints[sortedPoints.length - 1].y;

            if (!naturalCubicCoeffs || naturalCubicCoeffs.a.length === 0) {
                for (let i = 0; i < sortedPoints.length - 1; i++) {
                    if (targetX >= sortedPoints[i].x && targetX <= sortedPoints[i + 1].x) {
                        const p_start = sortedPoints[i];
                        const p_end = sortedPoints[i + 1];
                        if (p_end.x === p_start.x) return p_start.y;
                        return p_start.y + (targetX - p_start.x) * (p_end.y - p_start.y) / (p_end.x - p_start.x);
                    }
                }
                return getDefaultY();
            }

            const { a, b, c, d } = naturalCubicCoeffs;
            for (let i = 0; i < sortedPoints.length - 1; i++) {
                const p1_world = sortedPoints[i];
                const p2_world = sortedPoints[i + 1];

                if (targetX >= p1_world.x && targetX <= p2_world.x) {
                    if (a[i] === undefined || b[i] === undefined || c[i] === undefined || d[i] === undefined) {
                        if (p2_world.x === p1_world.x) return p1_world.y;
                        return p1_world.y + (targetX - p1_world.x) * (p2_world.y - p1_world.y) / (p2_world.x - p1_world.x);
                    }

                    const x0_coeff = p1_world.x;
                    const y0_coeff = a[i];

                    const deltaX_target = targetX - x0_coeff;
                    const interpolatedY = y0_coeff +
                        b[i] * deltaX_target +
                        c[i] * Math.pow(deltaX_target, 2) +
                        d[i] * Math.pow(deltaX_target, 3);
                    return interpolatedY;
                }
            }
            return getDefaultY();
        }
        return getDefaultY();
    }

    // Helper to get a default Y, clamped and rounded
    function getDefaultY() {
        return 0; // Y is open, default new points to y=0
    }

    // Function to calculate coefficients for a natural cubic spline
    // Based on George MacKerron's algorithm: http://blog.mackerron.com/2011/01/01/javascript-cubic-splines/
    function calculateNaturalCubicSplineCoeffs(currentPoints) {
        const n = currentPoints.length - 1;
        if (n < 1) {
            naturalCubicCoeffs = { a: [], b: [], c: [], d: [] };
            return;
        }

        const x = currentPoints.map(p => p.x);
        const y_coords = currentPoints.map(p => p.y); // Renamed from 'a' in MacKerron's to avoid conflict with coefficient 'a'

        const h = [];
        for (let i = 0; i < n; i++) {
            h[i] = x[i + 1] - x[i];
            if (h[i] === 0) { // Prevent division by zero if x-values are not distinct
                // console.warn("Duplicate x-values found in input points for spline calculation. Adjusting slightly.");
                // This case should ideally be prevented by drag/add logic ensuring distinct x for anchors
                // For now, if it happens, treat as a very small non-zero h to avoid NaN, or return error.
                // Or, handle by merging points/enforcing distinct x before this function is called.
                // For simplicity here, we'll let it potentially lead to issues if not handled upstream.
                // A robust solution would be to ensure x are distinct before calling this.
            }
        }

        const alpha = [];
        for (let i = 1; i < n; i++) {
            if (h[i - 1] === 0 || h[i] === 0) { // Avoid division by zero
                alpha[i] = 0;
            } else {
                alpha[i] = (3 / h[i]) * (y_coords[i + 1] - y_coords[i]) - (3 / h[i - 1]) * (y_coords[i] - y_coords[i - 1]);
            }
        }

        const c = new Array(n + 1).fill(0);
        const l = new Array(n + 1).fill(0);
        const mu = new Array(n + 1).fill(0);
        const z = new Array(n + 1).fill(0);

        l[0] = 1; // Natural spline: l_0 = 1, mu_0 = 0, z_0 = 0
        mu[0] = 0;
        z[0] = 0;

        for (let i = 1; i < n; i++) {
            if (h[i - 1] === 0) { // Avoid issues with h[i-1] being zero
                l[i] = 2 * (x[i + 1] - x[i - 1]); // Simplified if h[i-1] is zero, though this indicates bad input
            } else {
                l[i] = 2 * (x[i + 1] - x[i - 1]) - h[i - 1] * mu[i - 1];
            }
            if (l[i] === 0) { // Avoid division by zero
                mu[i] = 0;
                z[i] = 0;
            } else {
                mu[i] = h[i] / l[i];
                z[i] = (alpha[i] - h[i - 1] * z[i - 1]) / l[i];
            }
        }

        l[n] = 1; // Natural spline: l_n = 1, z_n = 0, c_n = 0
        z[n] = 0;
        c[n] = 0;

        const b = new Array(n).fill(0);
        const d = new Array(n).fill(0);
        const a_coeffs = y_coords.slice(0, n); // These are the 'a' coefficients (y-values of the points)

        for (let j = n - 1; j >= 0; j--) {
            c[j] = z[j] - mu[j] * c[j + 1];
            if (h[j] === 0) { // Avoid division by zero
                b[j] = 0;
                d[j] = 0;
            } else {
                b[j] = (y_coords[j + 1] - y_coords[j]) / h[j] - h[j] * (c[j + 1] + 2 * c[j]) / 3;
                d[j] = (c[j + 1] - c[j]) / (3 * h[j]);
            }
        }

        naturalCubicCoeffs = { a: a_coeffs, b: b, c: c.slice(0, n) /* c_n is 0 and not used for segments */, d: d };
        // console.log("Calculated Natural Cubic Spline Coeffs:", naturalCubicCoeffs, "for points:", currentPoints);
    }

    // Transformation functions
    function worldToCanvas(worldX, worldY) {
        const canvasWidth = canvas.width - 2 * padding;
        const canvasHeight = canvas.height - 2 * padding;

        const visibleYRange = baseVisibleYRange / yZoomFactor;
        const viewYMin = yViewCenter - visibleYRange / 2;
        const viewYMax = yViewCenter + visibleYRange / 2;

        const visibleXWorldRange = xMax / xZoomFactor;
        const viewXMin = xViewCenter - visibleXWorldRange / 2;
        const viewXMax = xViewCenter + visibleXWorldRange / 2;

        const canvasX = padding + ((worldX - viewXMin) / (viewXMax - viewXMin)) * canvasWidth;
        const canvasY = padding + canvasHeight - ((worldY - viewYMin) / (viewYMax - viewYMin)) * canvasHeight;
        return { x: canvasX, y: canvasY };
    }

    function canvasToWorld(canvasX, canvasY) {
        const canvasWidth = canvas.width - 2 * padding;
        const canvasHeight = canvas.height - 2 * padding;

        const visibleYRange = baseVisibleYRange / yZoomFactor;
        const viewYMin = yViewCenter - visibleYRange / 2;
        const viewYMax = yViewCenter + visibleYRange / 2;

        const visibleXWorldRange = xMax / xZoomFactor;
        const viewXMin = xViewCenter - visibleXWorldRange / 2;
        const viewXMax = xViewCenter + visibleXWorldRange / 2;

        const worldX = viewXMin + (((canvasX - padding) / canvasWidth) * (viewXMax - viewXMin));
        const worldY = viewYMin + ((canvasHeight - (canvasY - padding)) / canvasHeight) * (viewYMax - viewYMin);
        return { x: worldX, y: worldY };
    }

    // Canvas setup
    function resizeCanvas() {
        // Ensure the canvas drawingbuffer size matches its display size
        // Read the display size first
        const displayWidth = canvas.offsetWidth;
        const displayHeight = canvas.offsetHeight;

        // Check if the canvas size actually needs to change
        if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
            canvas.width = displayWidth;
            canvas.height = displayHeight;
            console.log(`Canvas resized to: ${canvas.width}x${canvas.height}`);
            draw();
        } else {
        }
    }

    // Initial drawing function (placeholder)
    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        drawAxes();

        ctx.save();
        ctx.beginPath();
        ctx.rect(padding, padding, canvas.width - 2 * padding, canvas.height - 2 * padding);
        ctx.clip();
        ctx.fillStyle = '#f0f0f0';
        ctx.fillRect(padding, padding, canvas.width - 2 * padding, canvas.height - 2 * padding);

        if (currentCurveType === 'spline') {
            drawSplineCurve();
        } else if (currentCurveType === 'step') {
            drawStepCurve();
        } else if (currentCurveType === 'natural') {
            drawNaturalSpline(); // Call the new drawing function
        } else if (currentCurveType === 'naturalCubic') {
            drawNaturalCubicSpline();
        }

        points.forEach((point, index) => {
            const canvasCoords = worldToCanvas(point.x, point.y);
            ctx.beginPath();
            let radius = 5;
            let baseColor = 'blue';

            if (point.type === 'anchor') {
                baseColor = 'blue'; // Anchors are blue
                radius = 6;
            } else if (point.type === 'control') {
                baseColor = 'green'; // Controls are green
                radius = 4;
                // Optionally draw as squares
                // ctx.rect(canvasCoords.x - radius, canvasCoords.y - radius, 2 * radius, 2 * radius);
            }

            if (index === selectedPointIndex && index === hoveredPointIndex) {
                radius *= 1.5;
                ctx.fillStyle = point.type === 'control' ? '#33FF33' : '#FF4444'; // Brighter green/red
            } else if (index === selectedPointIndex) {
                radius *= 1.2;
                ctx.fillStyle = point.type === 'control' ? 'darkgreen' : 'red';
            } else if (index === hoveredPointIndex) {
                radius *= 1.2;
                ctx.fillStyle = point.type === 'control' ? 'lightgreen' : 'pink';
            } else {
                ctx.fillStyle = baseColor;
            }

            if (point.type === 'control') {
                // Draw control points as squares
                ctx.fillRect(canvasCoords.x - radius, canvasCoords.y - radius, 2 * radius, 2 * radius);
            } else {
                // Anchors as circles
                ctx.arc(canvasCoords.x, canvasCoords.y, radius, 0, 2 * Math.PI);
                ctx.fill();
            }
            ctx.closePath();
        });

        ctx.restore();

        if (dragReadoutInfo) {
            ctx.fillStyle = 'black';
            ctx.font = '12px Arial';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'bottom';
            ctx.fillText(dragReadoutInfo.text, dragReadoutInfo.x, dragReadoutInfo.y);
        }
    }

    function drawAxes() {
        ctx.strokeStyle = 'black';
        ctx.lineWidth = 1;
        ctx.font = '12px Arial';
        ctx.fillStyle = 'black';

        ctx.beginPath();
        ctx.moveTo(padding, padding);
        ctx.lineTo(padding, canvas.height - padding);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(padding, canvas.height - padding);
        ctx.lineTo(canvas.width - padding, canvas.height - padding);
        ctx.stroke();

        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        const visibleYRange = baseVisibleYRange / yZoomFactor;
        const viewYMin = yViewCenter - visibleYRange / 2;
        const viewYMax = yViewCenter + visibleYRange / 2;

        for (let i = 0; i <= 10; i++) {
            const val = viewYMin + (i / 10) * (viewYMax - viewYMin);
            const { y } = worldToCanvas(0, val);
            ctx.fillText(val.toFixed(1), padding - 10, y);
            ctx.beginPath();
            ctx.moveTo(padding - 5, y);
            ctx.lineTo(padding + 5, y);
            ctx.stroke();
        }

        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const visibleXWorldRange_labels = xMax / xZoomFactor;
        const viewXMin_labels = xViewCenter - visibleXWorldRange_labels / 2;
        const viewXMax_labels = xViewCenter + visibleXWorldRange_labels / 2;

        for (let i = 0; i <= 10; i++) {
            const val = viewXMin_labels + (i / 10) * (viewXMax_labels - viewXMin_labels);
            const { x } = worldToCanvas(val, 0);
            ctx.fillText(val.toFixed(1), x, canvas.height - padding + 10);
            ctx.beginPath();
            ctx.moveTo(x, canvas.height - padding - 5);
            ctx.lineTo(x, canvas.height - padding + 5);
            ctx.stroke();
        }

        ctx.save();
        ctx.textAlign = 'center';
        ctx.translate(padding / 2 - 10, canvas.height / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText('Y', 0, 0);
        ctx.restore();

        ctx.textAlign = 'center';
        ctx.fillText('X', canvas.width / 2, canvas.height - padding / 2 + 10);
    }

    function drawSplineCurve() {
        if (points.length < 3) return; // Need at least A0, C0, A1

        ctx.strokeStyle = 'green';
        ctx.lineWidth = 2;
        ctx.beginPath();

        const p0_canvas = worldToCanvas(points[0].x, points[0].y);
        ctx.moveTo(p0_canvas.x, p0_canvas.y);

        for (let i = 0; i < points.length - 2; i += 2) {
            if (!points[i] || !points[i + 1] || !points[i + 2] || points[i].type !== 'anchor' || points[i + 1].type !== 'control' || points[i + 2].type !== 'anchor') {
                console.warn("Invalid point sequence for spline segment at index", i, points);
                // Attempt to draw a line to the next available anchor if the structure is broken
                if (points[i + 2]) { // If there's a point where the next anchor should be
                    const nextAnchorCanvas = worldToCanvas(points[i + 2].x, points[i + 2].y);
                    ctx.lineTo(nextAnchorCanvas.x, nextAnchorCanvas.y);
                }
                continue; // Skip this segment
            }
            const control_canvas = worldToCanvas(points[i + 1].x, points[i + 1].y);
            const anchor2_canvas = worldToCanvas(points[i + 2].x, points[i + 2].y);
            ctx.quadraticCurveTo(control_canvas.x, control_canvas.y, anchor2_canvas.x, anchor2_canvas.y);
        }
        ctx.stroke(); // Stroke the main curve path
        ctx.closePath();

        // If a segment is hovered, redraw it highlighted on top
        if (hoveredSplineSegmentIndex !== -1) {
            const i = hoveredSplineSegmentIndex; // This is the index of the first anchor of the segment
            // Ensure the segment points exist and are of the correct type
            if (points[i] && points[i + 1] && points[i + 2] &&
                points[i].type === 'anchor' && points[i + 1].type === 'control' && points[i + 2].type === 'anchor') {

                ctx.beginPath(); // Start a new path for the highlight
                const anchor1_canvas_h = worldToCanvas(points[i].x, points[i].y);
                const control_canvas_h = worldToCanvas(points[i + 1].x, points[i + 1].y);
                const anchor2_canvas_h = worldToCanvas(points[i + 2].x, points[i + 2].y);

                ctx.moveTo(anchor1_canvas_h.x, anchor1_canvas_h.y);
                ctx.strokeStyle = 'red'; // Highlight color
                ctx.lineWidth = 4;       // Highlight thickness
                ctx.quadraticCurveTo(control_canvas_h.x, control_canvas_h.y, anchor2_canvas_h.x, anchor2_canvas_h.y);
                ctx.stroke();
                ctx.closePath();
            }
        }

        // Draw lines from anchors to their control points (helper lines)
        ctx.strokeStyle = 'rgba(0, 100, 0, 0.3)'; // Light green, semi-transparent
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i < points.length - 1; i++) {
            if (points[i].type === 'anchor' && points[i + 1] && points[i + 1].type === 'control') {
                const p1_canvas = worldToCanvas(points[i].x, points[i].y);
                const cp_canvas = worldToCanvas(points[i + 1].x, points[i + 1].y);
                ctx.moveTo(p1_canvas.x, p1_canvas.y);
                ctx.lineTo(cp_canvas.x, cp_canvas.y);
            } else if (points[i].type === 'control' && points[i + 1] && points[i + 1].type === 'anchor') {
                const cp_canvas = worldToCanvas(points[i].x, points[i].y);
                const p2_canvas = worldToCanvas(points[i + 1].x, points[i + 1].y);
                ctx.moveTo(cp_canvas.x, cp_canvas.y);
                ctx.lineTo(p2_canvas.x, p2_canvas.y);
            }
        }
        ctx.stroke();
        ctx.closePath();
    }

    function drawStepCurve() {
        ctx.strokeStyle = 'orange';
        ctx.lineWidth = 2;
        if (points.length === 0) return;

        points.sort((a, b) => a.x - b.x);

        ctx.beginPath();
        let firstPointCanvas = worldToCanvas(points[0].x, points[0].y);
        ctx.moveTo(firstPointCanvas.x, firstPointCanvas.y);
        for (let i = 1; i < points.length; i++) {
            const prevPointWorld = points[i - 1];
            const currentPointWorld = points[i];

            const prevCanvasPoint = worldToCanvas(prevPointWorld.x, prevPointWorld.y);
            const currentCanvasPoint = worldToCanvas(currentPointWorld.x, currentPointWorld.y);

            if (hoveredSegmentIndex === i - 1) {
                ctx.strokeStyle = 'red';
                ctx.lineWidth = 4;
            } else {
                ctx.strokeStyle = 'orange';
                ctx.lineWidth = 2;
            }
            ctx.lineTo(currentCanvasPoint.x, prevCanvasPoint.y);
            ctx.stroke();

            ctx.strokeStyle = 'orange';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(currentCanvasPoint.x, prevCanvasPoint.y);
            ctx.lineTo(currentCanvasPoint.x, currentCanvasPoint.y);
            ctx.stroke();
        }
        ctx.strokeStyle = 'orange';
        ctx.lineWidth = 2;
    }

    function drawNaturalSpline() {
        if (points.length < 2) return;

        ctx.strokeStyle = 'purple';
        ctx.lineWidth = 2;
        ctx.beginPath();

        const sortedPoints = [...points].sort((a, b) => a.x - b.x);

        const firstPointCanvas = worldToCanvas(sortedPoints[0].x, sortedPoints[0].y);
        ctx.moveTo(firstPointCanvas.x, firstPointCanvas.y);

        if (sortedPoints.length === 2) {
            const secondPointCanvas = worldToCanvas(sortedPoints[1].x, sortedPoints[1].y);
            ctx.lineTo(secondPointCanvas.x, secondPointCanvas.y);
        } else {
            for (let i = 0; i < sortedPoints.length - 1; i++) {
                let p0, p1, p2, p3;

                p1 = sortedPoints[i];
                p2 = sortedPoints[i + 1];

                if (i === 0) {
                    p0 = p1;
                } else {
                    p0 = sortedPoints[i - 1];
                }

                if (i === sortedPoints.length - 2) {
                    p3 = p2;
                } else {
                    p3 = sortedPoints[i + 2];
                }

                const b1x = p1.x + (p2.x - p0.x) / 6;
                const b1y = p1.y + (p2.y - p0.y) / 6;
                const b2x = p2.x - (p3.x - p1.x) / 6;
                const b2y = p2.y - (p3.y - p1.y) / 6;

                const cp1_canvas = worldToCanvas(b1x, b1y);
                const cp2_canvas = worldToCanvas(b2x, b2y);
                const p2_canvas = worldToCanvas(p2.x, p2.y);

                ctx.bezierCurveTo(cp1_canvas.x, cp1_canvas.y, cp2_canvas.x, cp2_canvas.y, p2_canvas.x, p2_canvas.y);
            }
        }
        ctx.stroke();
        ctx.closePath();

        // Highlight hovered segment
        if (hoveredNaturalSegmentIndex !== -1 && hoveredNaturalSegmentIndex < sortedPoints.length - 1) {
            const i = hoveredNaturalSegmentIndex;
            let p0_h, p1_h, p2_h, p3_h;

            p1_h = sortedPoints[i];
            p2_h = sortedPoints[i + 1];

            if (i === 0) {
                p0_h = p1_h;
            } else {
                p0_h = sortedPoints[i - 1];
            }

            if (i === sortedPoints.length - 2) {
                p3_h = p2_h;
            } else {
                p3_h = sortedPoints[i + 2];
            }

            const b1x_h = p1_h.x + (p2_h.x - p0_h.x) / 6;
            const b1y_h = p1_h.y + (p2_h.y - p0_h.y) / 6;
            const b2x_h = p2_h.x - (p3_h.x - p1_h.x) / 6;
            const b2y_h = p2_h.y - (p3_h.y - p1_h.y) / 6;

            const p1_canvas_h = worldToCanvas(p1_h.x, p1_h.y);
            const cp1_canvas_h = worldToCanvas(b1x_h, b1y_h);
            const cp2_canvas_h = worldToCanvas(b2x_h, b2y_h);
            const p2_canvas_h = worldToCanvas(p2_h.x, p2_h.y);

            ctx.beginPath();
            ctx.moveTo(p1_canvas_h.x, p1_canvas_h.y);
            ctx.strokeStyle = 'red';
            ctx.lineWidth = 4;
            ctx.bezierCurveTo(cp1_canvas_h.x, cp1_canvas_h.y, cp2_canvas_h.x, cp2_canvas_h.y, p2_canvas_h.x, p2_canvas_h.y);
            ctx.stroke();
            ctx.closePath();
        }
    }

    function drawNaturalCubicSpline() {
        if (points.length < 2 || !naturalCubicCoeffs || naturalCubicCoeffs.a.length === 0) return;

        ctx.strokeStyle = 'teal';
        ctx.lineWidth = 2;
        ctx.beginPath();

        const sortedPoints = [...points].sort((a, b) => a.x - b.x);
        if (sortedPoints.length === 0) return;

        const { a, b, c, d } = naturalCubicCoeffs;

        for (let i = 0; i < sortedPoints.length - 1; i++) {
            const p1_world = sortedPoints[i];
            const p2_world = sortedPoints[i + 1];

            // Ensure coefficients for this segment exist
            if (a[i] === undefined || b[i] === undefined || c[i] === undefined || d[i] === undefined) {
                // Fallback to a straight line if coeffs are missing for some reason
                if (i === 0) {
                    const p_canvas_start = worldToCanvas(p1_world.x, p1_world.y);
                    ctx.moveTo(p_canvas_start.x, p_canvas_start.y);
                }
                const p_canvas_end = worldToCanvas(p2_world.x, p2_world.y);
                ctx.lineTo(p_canvas_end.x, p_canvas_end.y);
                console.warn(`Missing coefficients for naturalCubic segment ${i}`);
                continue;
            }

            const x0 = p1_world.x;
            const y0 = a[i]; // a[i] is essentially y0 of the segment

            if (i === 0) {
                const p_canvas_start = worldToCanvas(x0, y0);
                ctx.moveTo(p_canvas_start.x, p_canvas_start.y);
            }

            const numSamples = Math.max(10, Math.round((p2_world.x - p1_world.x))); // More samples for wider segments
            for (let j = 1; j <= numSamples; j++) {
                const t = j / numSamples;
                const currentX = x0 + t * (p2_world.x - x0);
                const deltaX = currentX - x0;

                const interpolatedY = y0 +
                    b[i] * deltaX +
                    c[i] * Math.pow(deltaX, 2) +
                    d[i] * Math.pow(deltaX, 3);

                const canvasP = worldToCanvas(currentX, interpolatedY);
                ctx.lineTo(canvasP.x, canvasP.y);
            }
        }
        ctx.stroke();
        ctx.closePath();

        // Highlight hovered segment
        if (hoveredNaturalCubicSegmentIndex !== -1 && hoveredNaturalCubicSegmentIndex < sortedPoints.length - 1) {
            const i = hoveredNaturalCubicSegmentIndex;
            const p1_world_h = sortedPoints[i];
            const p2_world_h = sortedPoints[i + 1];

            if (a[i] !== undefined && b[i] !== undefined && c[i] !== undefined && d[i] !== undefined) {
                ctx.beginPath();
                const x0_h = p1_world_h.x;
                const y0_h = a[i];

                const p_canvas_start_h = worldToCanvas(x0_h, y0_h);
                ctx.moveTo(p_canvas_start_h.x, p_canvas_start_h.y);
                ctx.strokeStyle = 'red';
                ctx.lineWidth = 4;

                const numSamples_h = Math.max(10, Math.round((p2_world_h.x - p1_world_h.x)));
                for (let j = 1; j <= numSamples_h; j++) {
                    const t = j / numSamples_h;
                    const currentX_h = x0_h + t * (p2_world_h.x - x0_h);
                    const deltaX_h = currentX_h - x0_h;

                    const interpolatedY_h = y0_h +
                        b[i] * deltaX_h +
                        c[i] * Math.pow(deltaX_h, 2) +
                        d[i] * Math.pow(deltaX_h, 3);
                    const canvasP_h = worldToCanvas(currentX_h, interpolatedY_h);
                    ctx.lineTo(canvasP_h.x, canvasP_h.y);
                }
                ctx.stroke();
                ctx.closePath();
            }
        }
    }

    // Event Listeners
    curveTypeSelect.addEventListener('change', (e) => {
        currentCurveType = e.target.value;
        points = [];
        selectedPointIndex = -1;
        isDraggingPoint = false;
        draggingSegmentIndex = -1;
        hoveredPointIndex = -1; // Reset hover state too
        hoveredSegmentIndex = -1;
        hoveredSplineSegmentIndex = -1;
        hoveredNaturalSegmentIndex = -1;
        hoveredNaturalCubicSegmentIndex = -1; // Reset natural cubic hover
        dragReadoutInfo = null;

        if (currentCurveType === 'step') {
            // Set Y-range for step: -10 to 1000
            yViewCenter = 495;
            baseVisibleYRange = 1010;
            const defaultY = 0; // Points at y=0 for step
            points.push({ x: 0, y: defaultY });
            points.push({ x: xMax, y: defaultY });
            points.sort((a, b) => a.x - b.x);
        } else if (currentCurveType === 'spline') {
            // Set Y-range for spline: -1000 to 1000
            yViewCenter = 0;
            baseVisibleYRange = 2000;
            let initialSplineY = 0; // Centered in the new Y range
            points = [
                { x: 0, y: initialSplineY, type: 'anchor' },
                { x: Math.round(xMax / 2), y: initialSplineY, type: 'control' },
                { x: xMax, y: initialSplineY, type: 'anchor' }
            ];
        } else if (currentCurveType === 'natural') {
            // Set Y-range (can be same as spline or specific)
            yViewCenter = 0;
            baseVisibleYRange = 2000;
            const defaultY = 0;
            points = [
                { x: 0, y: defaultY, type: 'anchor' }, // All points are anchors for natural spline
                { x: xMax, y: defaultY, type: 'anchor' }
            ];
            // Points for natural splines are all anchors, no specific types needed beyond that for now.
            // Ensure they are sorted if more than two are added by default, or ensure initial state is simple.
            points.sort((a, b) => a.x - b.x);
        } else if (currentCurveType === 'naturalCubic') {
            // Set Y-range (can be same as spline or specific)
            yViewCenter = 0;
            baseVisibleYRange = 2000;
            const defaultY = 0;
            points = [
                { x: 0, y: defaultY, type: 'anchor' },
                { x: xMax, y: defaultY, type: 'anchor' }
            ];
            points.sort((a, b) => a.x - b.x);
            // TODO: Initialize coefficients for natural cubic spline
            calculateNaturalCubicSplineCoeffs(points);
        }
        // Reset zoom factors for Y axis to default when type changes
        yZoomFactor = 1;
        yZoomSlider.value = yZoomFactor;
        yZoomValueDisplay.textContent = yZoomFactor.toFixed(2);
        // X zoom can remain as is or be reset, let's reset it for consistency here
        xZoomFactor = 1;
        xZoomSlider.value = xZoomFactor;
        xZoomValueDisplay.textContent = xZoomFactor.toFixed(1);
        xViewCenter = xMax / 2;

        draw();
    });

    canvas.addEventListener('mousedown', (e) => {
        const mouseCanvasX = e.offsetX;
        const mouseCanvasY = e.offsetY;
        const worldMouseCoords = canvasToWorld(mouseCanvasX, mouseCanvasY);

        isDraggingPoint = false;
        draggingSegmentIndex = -1;
        isPanningY = false;
        isPanningX = false;
        linkedPartnersInfo = []; // Reset C1 drag info
        draggedAnchorInfo = null; // Reset dragged anchor info

        let interactionStarted = false;

        if (hoveredPointIndex !== -1) {
            selectedPointIndex = hoveredPointIndex;
            isDraggingPoint = true;
            interactionStarted = true;
            const selectedPoint = points[selectedPointIndex];
            linkedPartnersInfo = []; // Ensure it's reset here before populating
            draggedAnchorInfo = null; // Ensure it's reset here before populating

            // If dragging a spline control point, check for C1 continuity linkage
            if (currentCurveType === 'spline' && selectedPoint.type === 'control') {
                const c_idx = selectedPointIndex;
                const a_l_idx = c_idx - 1;
                const a_r_idx = c_idx + 1;

                // Check link through left anchor A_L (points[a_l_idx])
                if (a_l_idx > 0) {
                    const c_partner_idx = a_l_idx - 1;
                    if (points[c_partner_idx] && points[c_partner_idx].type === 'control' && points[a_l_idx] && points[a_l_idx].type === 'anchor') {
                        const pivotAnchor = points[a_l_idx];
                        const partnerControl = points[c_partner_idx];
                        const dist = Math.sqrt(Math.pow(partnerControl.x - pivotAnchor.x, 2) + Math.pow(partnerControl.y - pivotAnchor.y, 2));
                        linkedPartnersInfo.push({
                            index: c_partner_idx,
                            originalDistance: dist,
                            pivotAnchorIndex: a_l_idx,
                            draggedControlIndex: c_idx,
                            isLeftLink: true // Mark that this link is to the "left" of the dragged point via its left anchor
                        });
                    }
                }

                // Check link through right anchor A_R (points[a_r_idx])
                if (a_r_idx < points.length - 1) {
                    const c_partner_idx = a_r_idx + 1;
                    if (points[c_partner_idx] && points[c_partner_idx].type === 'control' && points[a_r_idx] && points[a_r_idx].type === 'anchor') {
                        const pivotAnchor = points[a_r_idx];
                        const partnerControl = points[c_partner_idx];
                        const dist = Math.sqrt(Math.pow(partnerControl.x - pivotAnchor.x, 2) + Math.pow(partnerControl.y - pivotAnchor.y, 2));
                        linkedPartnersInfo.push({
                            index: c_partner_idx,
                            originalDistance: dist,
                            pivotAnchorIndex: a_r_idx,
                            draggedControlIndex: c_idx,
                            isLeftLink: false // Mark that this link is to the "right" of the dragged point via its right anchor
                        });
                    }
                }
            }
            // If dragging a spline anchor point, store control point offsets
            else if (currentCurveType === 'spline' && selectedPoint.type === 'anchor') {
                const anchorIdx = selectedPointIndex;
                let c_before_offset = null;
                let c_after_offset = null;
                let type = 'intermediate';

                // Check for control point before (c_before)
                if (anchorIdx > 0 && points[anchorIdx - 1] && points[anchorIdx - 1].type === 'control') {
                    const c_before = points[anchorIdx - 1];
                    c_before_offset = { dx: c_before.x - selectedPoint.x, dy: c_before.y - selectedPoint.y };
                }

                // Check for control point after (c_after)
                if (anchorIdx < points.length - 1 && points[anchorIdx + 1] && points[anchorIdx + 1].type === 'control') {
                    const c_after = points[anchorIdx + 1];
                    c_after_offset = { dx: c_after.x - selectedPoint.x, dy: c_after.y - selectedPoint.y };
                }

                if (!c_before_offset && c_after_offset) type = 'start'; // e.g. A0, C0, A1 (dragging A0)
                else if (c_before_offset && !c_after_offset) type = 'end'; // e.g. A0, C0, A1 (dragging A1)
                // If both, it's intermediate. If neither, it's an isolated anchor (should not happen in A-C-A chain)

                draggedAnchorInfo = { type: type, c_before_offset: c_before_offset, c_after_offset: c_after_offset, originalAnchorX: selectedPoint.x, originalAnchorY: selectedPoint.y };
            }
        }
        else if (currentCurveType === 'step' && hoveredSegmentIndex !== -1) {
            draggingSegmentIndex = hoveredSegmentIndex;
            selectedPointIndex = hoveredSegmentIndex;
            interactionStarted = true;
        }

        if (interactionStarted) {
            draw();
        } else {
            if (!interactionStarted &&
                mouseCanvasX > padding && mouseCanvasX < canvas.width - padding &&
                mouseCanvasY > padding && mouseCanvasY < canvas.height - padding) {

                isPanningY = true;
                panStartY_canvas = mouseCanvasY;
                panStart_yViewCenter = yViewCenter;

                console.log(`MOUSEDOWN before setting isPanningX: ${isPanningX}`);
                isPanningX = true;
                panStartX_canvas = mouseCanvasX;
                panStart_xViewCenter = xViewCenter;
                console.log(`MOUSEDOWN empty space: Set isPanningX=${isPanningX}, isPanningY=${isPanningY}`);

            } else {
                console.log(`MOUSEDOWN non-pan: interactionStarted=${interactionStarted}, mouseX=${mouseCanvasX}, mouseY=${mouseCanvasY}`);
            }
        }
    });

    updateCoordsButton.addEventListener('click', () => {
        const newXMaxVal = Math.round(parseFloat(xMaxInput.value));

        if (isNaN(newXMaxVal) || newXMaxVal <= 0) {
            alert("X-Max must be a positive number.");
            xMaxInput.value = xMax;
            return;
        }

        const oldXMax = xMax;
        xMax = newXMaxVal;

        xMaxInput.value = xMax;

        xViewCenter = xMax / 2;
        xZoomFactor = 1;
        xZoomSlider.value = xZoomFactor;
        xZoomValueDisplay.textContent = xZoomFactor.toFixed(1);

        if (points.length > 0) {
            points.sort((a, b) => a.x - b.x);
            let yForNewXMaxPoint = getDefaultY();

            if (xMax < oldXMax) {
                const lastPointBeforeOrAtNewXMax = points.slice().reverse().find(p => p.x <= xMax);
                if (lastPointBeforeOrAtNewXMax) {
                    yForNewXMaxPoint = lastPointBeforeOrAtNewXMax.y;
                }
                points = points.filter(p => p.x <= xMax);

                if (points.length > 0) {
                    let lastPoint = points[points.length - 1];
                    if (lastPoint.x < xMax) {
                        points.push({ x: xMax, y: yForNewXMaxPoint });
                    } else if (lastPoint.x === xMax) {
                        lastPoint.y = yForNewXMaxPoint;
                    }
                } else {
                    points.push({ x: xMax, y: yForNewXMaxPoint });
                }

            } else {
                if (points.length > 0) {
                    let lastPoint = points[points.length - 1];
                    yForNewXMaxPoint = lastPoint.y;
                    lastPoint.x = xMax;
                } else {
                }
            }

            if (currentCurveType === 'step') {
                let zeroPoint = points.find(p => p.x === 0);
                if (!zeroPoint) {
                    const yForZero = points.length > 0 ? points[0].y : getDefaultY();
                    points.unshift({ x: 0, y: yForZero });
                } else {
                    if (points.indexOf(zeroPoint) !== 0) {
                        points = points.filter(p => p !== zeroPoint);
                        points.unshift(zeroPoint);
                    }
                }

                if (!points.some(p => p.x === xMax)) {
                    const yVal = points.length > 0 ? points[points.length - 1].y : getDefaultY();
                    points.push({ x: xMax, y: yVal });
                }
                points.sort((a, b) => a.x - b.x);
            }

            // Specific handling for spline curves when xMax changes
            if (currentCurveType === 'spline' && points.length > 0) {
                // This logic block is specifically for 'spline' type when xMax changes.
                // General filtering for points beyond xMax should occur before this block
                // if it's intended to apply to all curve types.
                // For splines, we must carefully maintain the A-C-A... structure.

                // 1. Preserve existing points that are within the new xMax.
                //    The first point (A0) is always kept and its x is set to 0.
                //    The last point (An) will be adjusted or created at the new xMax.
                let newPoints = [];
                if (points.length > 0) {
                    newPoints.push(points[0]); // Keep the first point
                    points[0].x = 0; // Ensure it's at x=0
                    points[0].type = 'anchor';

                    for (let i = 1; i < points.length; i++) {
                        if (points[i].x <= xMax) {
                            newPoints.push(points[i]);
                        } else {
                            // If a point is beyond the new xMax, and it's the one just before
                            // where the new last anchor would be, we might stop adding points.
                            // For example, if old xMax was 100, new is 50. A point at x=60 is out.
                            // If the point *before* it was a control point, that control point's
                            // corresponding anchor (the one at x=60) is now gone.
                            // We need to ensure the list ends with an anchor at the new xMax.
                            break; // Stop taking points beyond new xMax
                        }
                    }
                }
                points = newPoints;

                // 2. Ensure the last point is an anchor at the new xMax.
                if (points.length === 0) { // Should not happen if we always keep/add point 0
                    points = [
                        { x: 0, y: getDefaultY(), type: 'anchor' },
                        { x: Math.round(xMax / 2), y: getDefaultY(), type: 'control' },
                        { x: xMax, y: getDefaultY(), type: 'anchor' }
                    ];
                } else {
                    // If last point is before new xMax or not an anchor, adjust/add.
                    if (points[points.length - 1].x < xMax || points[points.length - 1].type !== 'anchor') {
                        // If the current last point is a control, remove it to make space for the new anchor.
                        if (points[points.length - 1].type === 'control') {
                            points.pop();
                        }
                        // If after popping, the list is empty or the new last point is still not at xMax.
                        if (points.length === 0 || points[points.length - 1].x < xMax) {
                            points.push({ x: xMax, y: (points.length > 0 ? points[points.length - 1].y : getDefaultY()), type: 'anchor' });
                        } else { // Last point exists and is at or beyond xMax (should be at if logic is right)
                            points[points.length - 1].x = xMax;
                            points[points.length - 1].type = 'anchor';
                        }
                    } else { // Last point is already an anchor at or beyond xMax
                        points[points.length - 1].x = xMax; // Ensure it's exactly xMax
                        points[points.length - 1].type = 'anchor';
                    }
                }

                // 3. Validate and fix A-C-A... structure.
                //    The points array should have an odd number of points: A, C, A, ..., C, A.
                if (points.length > 0 && points.length % 2 === 0) {
                    // Even number of points means invalid structure (e.g., A, C, A, C).
                    // Typically, remove the last control point.
                    points.pop();
                }

                // Ensure the types are correct: Anchor, Control, Anchor, ...
                for (let i = 0; i < points.length; i++) {
                    points[i].type = (i % 2 === 0) ? 'anchor' : 'control';
                }

                // If only one point remains (must be an anchor at x=0), add C and A1.
                if (points.length === 1) {
                    points[0].x = 0; points[0].type = 'anchor'; // Make sure
                    points.push({ x: Math.round(xMax / 2), y: points[0].y, type: 'control' });
                    points.push({ x: xMax, y: points[0].y, type: 'anchor' });
                }

                // Ensure control points X are between their anchors' X
                for (let i = 1; i < points.length - 1; i += 2) { // Iterate over control points
                    const cp = points[i];
                    const anchorLeft = points[i - 1];
                    const anchorRight = points[i + 1];
                    if (cp && anchorLeft && anchorRight) { // Ensure all three points exist
                        cp.x = Math.max(anchorLeft.x, Math.min(anchorRight.x, cp.x));
                    }
                }
                // Final check: make sure first point is Anchor at 0, last is Anchor at xMax
                if (points.length > 0) {
                    points[0].x = 0; points[0].type = 'anchor';
                    points[points.length - 1].x = xMax; points[points.length - 1].type = 'anchor';
                }
            } else if (currentCurveType === 'natural') {
                // Ensure points at 0 and xMax, all are anchors
                let zeroPoint = points.find(p => p.x === 0);
                if (!zeroPoint) {
                    const yForZero = points.length > 0 ? points[0].y : getDefaultY();
                    points.unshift({ x: 0, y: yForZero, type: 'anchor' });
                } else {
                    zeroPoint.type = 'anchor'; // Ensure type
                    if (points.indexOf(zeroPoint) !== 0) { // If 0-point exists but not first
                        points = points.filter(p => p !== zeroPoint);
                        points.unshift(zeroPoint);
                    }
                }

                let xMaxPoint = points.find(p => p.x === xMax);
                if (!xMaxPoint) {
                    const yVal = points.length > 0 ? points[points.length - 1].y : getDefaultY();
                    points.push({ x: xMax, y: yVal, type: 'anchor' });
                } else {
                    xMaxPoint.type = 'anchor'; // Ensure type
                }
                // Ensure all points are anchors and within bounds
                points = points.filter(p => p.x <= xMax && p.x >= 0);
                points.forEach(p => {
                    p.type = 'anchor';
                    p.x = Math.round(Math.max(0, Math.min(xMax, p.x)));
                });
                points.sort((a, b) => a.x - b.x);
                calculateNaturalCubicSplineCoeffs(points); // Added this call
            } else if (currentCurveType === 'naturalCubic') {
                // Ensure points at 0 and xMax, all are anchors
                let zeroPoint = points.find(p => p.x === 0);
                if (!zeroPoint) {
                    const yForZero = points.length > 0 ? points[0].y : getDefaultY();
                    points.unshift({ x: 0, y: yForZero, type: 'anchor' });
                } else {
                    zeroPoint.type = 'anchor'; // Ensure type
                    if (points.indexOf(zeroPoint) !== 0) { // If 0-point exists but not first
                        points = points.filter(p => p !== zeroPoint);
                        points.unshift(zeroPoint);
                    }
                }

                let xMaxPoint = points.find(p => p.x === xMax);
                if (!xMaxPoint) {
                    const yVal = points.length > 0 ? points[points.length - 1].y : getDefaultY();
                    points.push({ x: xMax, y: yVal, type: 'anchor' });
                } else {
                    xMaxPoint.type = 'anchor'; // Ensure type
                }
                // Ensure all points are anchors and within bounds
                points = points.filter(p => p.x <= xMax && p.x >= 0);
                points.forEach(p => {
                    p.type = 'anchor';
                    p.x = Math.round(Math.max(0, Math.min(xMax, p.x)));
                });
                points.sort((a, b) => a.x - b.x);
                calculateNaturalCubicSplineCoeffs(points); // Added this call
            }

            points = points.filter((point, index, self) =>
                index === self.findIndex((p) => (p.x === point.x && p.y === point.y))
            );

        } else {
            if (currentCurveType === 'step') {
                const defaultY = getDefaultY();
                points.push({ x: 0, y: defaultY });
                points.push({ x: xMax, y: defaultY });
            }
        }

        selectedPointIndex = -1;
        hoveredPointIndex = -1;
        hoveredSegmentIndex = -1;
        hoveredSplineSegmentIndex = -1;
        hoveredNaturalSegmentIndex = -1;
        hoveredNaturalCubicSegmentIndex = -1; // Reset natural cubic hover
        isDraggingPoint = false;
        draggingSegmentIndex = -1;
        dragReadoutInfo = null;
        draw();
    });

    canvas.addEventListener('mousemove', (e) => {
        const mouseCanvasX = e.offsetX;
        const mouseCanvasY = e.offsetY;
        const worldMouseCoords = canvasToWorld(mouseCanvasX, mouseCanvasY);

        let needsRedraw = false;
        let currentDragReadoutText = dragReadoutInfo ? dragReadoutInfo.text : null;

        if (isDraggingPoint && selectedPointIndex !== -1) {
            let targetPoint = points[selectedPointIndex];

            let newWorldX = Math.round(Math.max(0, Math.min(xMax, worldMouseCoords.x)));
            let newWorldY = Math.round(worldMouseCoords.y);

            if (currentCurveType === 'step') {
                const prevPointX = (selectedPointIndex > 0) ? points[selectedPointIndex - 1].x : -Infinity;
                const nextPointX = (selectedPointIndex < points.length - 1) ? points[selectedPointIndex + 1].x : Infinity;

                if (selectedPointIndex === 0 && points[0].x === 0) newWorldX = 0;
                else if (selectedPointIndex === points.length - 1 && points[selectedPointIndex].x === xMax) newWorldX = xMax;
                else {
                    newWorldX = Math.max(prevPointX + 1, Math.min(nextPointX - 1, newWorldX));
                }
            } else if (currentCurveType === 'spline') {
                if (selectedPointIndex === 0) { // First anchor (A0)
                    newWorldX = 0;
                } else if (selectedPointIndex === points.length - 1) { // Last anchor (An)
                    newWorldX = xMax;
                } else { // Intermediate anchors (Ai) or any control point (Ci)
                    newWorldX = Math.round(Math.max(0, Math.min(xMax, worldMouseCoords.x))); // General 0-xMax clamp for intermediate points

                    // <<<< START INTERMEDIATE ANCHOR X-CLAMPING >>>>
                    if (targetPoint.type === 'anchor') { // This implies it's an intermediate anchor due to the outer if/else
                        const prevAnchorX = points[selectedPointIndex - 2].x; // A_k-1 is at index selectedPointIndex - 2
                        const nextAnchorX = points[selectedPointIndex + 2].x; // A_k+1 is at index selectedPointIndex + 2

                        // Ensure a minimum separation of 1 unit if possible
                        const minX = prevAnchorX + 1;
                        const maxX = nextAnchorX - 1;

                        if (minX > maxX) { // Not enough space for separation, clamp to exact previous/next if crossed
                            if (newWorldX < prevAnchorX) newWorldX = prevAnchorX;
                            if (newWorldX > nextAnchorX) newWorldX = nextAnchorX;
                            // If a very small xMax, it's possible minX or maxX are out of 0-xMax. The initial clamp handles this.
                        } else {
                            newWorldX = Math.max(minX, Math.min(maxX, newWorldX));
                        }
                        // Final global clamp as a safeguard, though the above logic should respect 0-xMax via prev/next anchors
                        newWorldX = Math.max(0, Math.min(xMax, newWorldX));
                    }
                    // <<<< END INTERMEDIATE ANCHOR X-CLAMPING >>>>
                }
                // Y (newWorldY) is already calculated and not constrained for spline points here

                // <<<< START X-CLAMPING FOR CONTROL POINTS >>>>
                if (targetPoint.type === 'control') {
                    const anchorLeft = points[selectedPointIndex - 1];
                    const anchorRight = points[selectedPointIndex + 1];
                    if (anchorLeft && anchorRight) { // Ensure anchors exist
                        const minAnchorX = Math.min(anchorLeft.x, anchorRight.x);
                        const maxAnchorX = Math.max(anchorLeft.x, anchorRight.x);
                        newWorldX = Math.max(minAnchorX, Math.min(maxAnchorX, newWorldX));
                    } else {
                        // This case should ideally not happen for a valid control point
                        console.warn("Control point being dragged is missing one or both anchors.");
                    }
                }
                // <<<< END X-CLAMPING FOR CONTROL POINTS >>>>
            } else if (currentCurveType === 'natural') {
                // All points are anchors.
                // First point (index 0) x is fixed at 0.
                // Last point (index points.length - 1) x is fixed at xMax.
                // Intermediate points can have x dragged.

                if (selectedPointIndex === 0) {
                    newWorldX = 0;
                } else if (selectedPointIndex === points.length - 1) {
                    newWorldX = xMax;
                } else {
                    // Intermediate point X dragging
                    const prevPointX = points[selectedPointIndex - 1].x;
                    const nextPointX = points[selectedPointIndex + 1].x;

                    // Clamp newWorldX to be between prevPointX + 1 and nextPointX - 1
                    // And also within the global 0 to xMax bounds (already handled by initial newWorldX calculation)
                    newWorldX = Math.max(prevPointX + 1, Math.min(nextPointX - 1, newWorldX));
                    newWorldX = Math.max(0, Math.min(xMax, newWorldX)); // Ensure global bounds
                }
                // Y (newWorldY) is already calculated and not constrained for natural spline points here
            } else if (currentCurveType === 'naturalCubic') {
                // All points are anchors.
                // First point (index 0) x is fixed at 0.
                // Last point (index points.length - 1) x is fixed at xMax.
                // Intermediate points can have x dragged.

                if (selectedPointIndex === 0) {
                    newWorldX = 0;
                } else if (selectedPointIndex === points.length - 1) {
                    newWorldX = xMax;
                } else {
                    // Intermediate point X dragging
                    const prevPointX = points[selectedPointIndex - 1].x;
                    const nextPointX = points[selectedPointIndex + 1].x;

                    // Clamp newWorldX to be between prevPointX + 1 and nextPointX - 1
                    // And also within the global 0 to xMax bounds (already handled by initial newWorldX calculation)
                    newWorldX = Math.max(prevPointX + 1, Math.min(nextPointX - 1, newWorldX));
                    newWorldX = Math.max(0, Math.min(xMax, newWorldX)); // Ensure global bounds
                }
                // Y (newWorldY) is already calculated and not constrained for natural cubic spline points here
            }

            // Update target point's main position first
            targetPoint.x = newWorldX;
            targetPoint.y = newWorldY;

            if (currentCurveType === 'naturalCubic') {
                // Ensure points are sorted before recalculating coefficients, esp. if x can change
                points.sort((a, b) => a.x - b.x);
                // After sorting, the selected point might have a new index if its x changed relative to others
                selectedPointIndex = points.findIndex(p => p === targetPoint);
                calculateNaturalCubicSplineCoeffs(points);
            }

            // <<<< START ANCHOR DRAG C1 HANDLING >>>>
            if (currentCurveType === 'spline' && draggedAnchorInfo && targetPoint.type === 'anchor' && selectedPointIndex !== -1) {
                const anchor = targetPoint; // This is points[selectedPointIndex]
                // Apply original offsets to move control points relative to the anchor
                if (draggedAnchorInfo.c_before_offset && points[selectedPointIndex - 1]) {
                    const c_before = points[selectedPointIndex - 1];
                    c_before.x = Math.round(anchor.x + draggedAnchorInfo.c_before_offset.dx);
                    c_before.y = Math.round(anchor.y + draggedAnchorInfo.c_before_offset.dy);

                    // X-Clamp c_before
                    const c_before_anchor_left = points[selectedPointIndex - 2]; // This is A_k-1
                    const c_before_anchor_right = anchor; // This is A_k (the one being dragged)
                    if (c_before_anchor_left && c_before_anchor_right) {
                        const minX = Math.min(c_before_anchor_left.x, c_before_anchor_right.x);
                        const maxX = Math.max(c_before_anchor_left.x, c_before_anchor_right.x);
                        c_before.x = Math.max(minX, Math.min(maxX, c_before.x));
                    }
                }
                if (draggedAnchorInfo.c_after_offset && points[selectedPointIndex + 1]) {
                    const c_after = points[selectedPointIndex + 1];
                    c_after.x = Math.round(anchor.x + draggedAnchorInfo.c_after_offset.dx);
                    c_after.y = Math.round(anchor.y + draggedAnchorInfo.c_after_offset.dy);

                    // X-Clamp c_after
                    const c_after_anchor_left = anchor; // This is A_k (the one being dragged)
                    const c_after_anchor_right = points[selectedPointIndex + 2]; // This is A_k+1
                    if (c_after_anchor_left && c_after_anchor_right) {
                        const minX = Math.min(c_after_anchor_left.x, c_after_anchor_right.x);
                        const maxX = Math.max(c_after_anchor_left.x, c_after_anchor_right.x);
                        c_after.x = Math.max(minX, Math.min(maxX, c_after.x));
                    }
                }
                // If the anchor being dragged is an endpoint, its C1 partner link might need to be updated too
                // This is handled by the linkedPartnersInfo if the *control point* of an endpoint is dragged.
                // Here we are dragging the anchor itself. The main goal is to keep its own control arms relative.
            }
            // <<<< END ANCHOR DRAG C1 HANDLING >>>>

            // <<<< START C1 CONTINUITY LINKAGE (FOR CONTROL POINT DRAG) >>>>
            if (currentCurveType === 'spline' && linkedPartnersInfo.length > 0 && targetPoint.type === 'control') {
                const draggedControl = targetPoint; // This is points[selectedPointIndex]

                for (const partnerInfo of linkedPartnersInfo) {
                    // Ensure the draggedControlIndex in partnerInfo still matches the currently selected point
                    // This is a sanity check, should generally be true if linkedPartnersInfo was populated for selectedPointIndex
                    if (partnerInfo.draggedControlIndex !== selectedPointIndex) continue;

                    const pivotAnchor = points[partnerInfo.pivotAnchorIndex];
                    const partnerCP = points[partnerInfo.index];

                    const dx_vec = draggedControl.x - pivotAnchor.x;
                    const dy_vec = draggedControl.y - pivotAnchor.y;
                    const len_vec = Math.sqrt(dx_vec * dx_vec + dy_vec * dy_vec);

                    if (len_vec > 1e-5) { // Avoid division by zero if points are coincident
                        const norm_dx = dx_vec / len_vec;
                        const norm_dy = dy_vec / len_vec;

                        partnerCP.x = Math.round(pivotAnchor.x - norm_dx * partnerInfo.originalDistance);
                        partnerCP.y = Math.round(pivotAnchor.y - norm_dy * partnerInfo.originalDistance);

                        // Now, X-clamp the partner control point (partnerCP) between its own anchors
                        // The partnerCP is points[partnerInfo.index]. Its anchors are at index-1 and index+1 from itself.
                        const partnerAnchorLeft = points[partnerInfo.index - 1];
                        const partnerAnchorRight = points[partnerInfo.index + 1];

                        if (partnerAnchorLeft && partnerAnchorRight) {
                            const minPartnerAnchorX = Math.min(partnerAnchorLeft.x, partnerAnchorRight.x);
                            const maxPartnerAnchorX = Math.max(partnerAnchorLeft.x, partnerAnchorRight.x);
                            partnerCP.x = Math.max(minPartnerAnchorX, Math.min(maxPartnerAnchorX, partnerCP.x));
                        } else {
                            console.warn("Partner control point for C1 link is missing one or both anchors for X-clamping.");
                        }
                    } else {
                        // Dragged control is coincident with pivot. Partner maintains original distance in some default direction or doesn't move.
                        // For simplicity, if they are coincident, don't move the partnerCP from its last calculated position.
                        // Or, one could define a default behavior like making the arm horizontal.
                    }
                }
            }
            // <<<< END C1 CONTINUITY LINKAGE (FOR CONTROL POINT DRAG) >>>>

            // ADDED: Recalculate coefficients if dragging a naturalCubic spline point
            if (currentCurveType === 'naturalCubic') {
                points.sort((a, b) => a.x - b.x); // Sort again if x could have changed relative to others
                selectedPointIndex = points.findIndex(p => p === targetPoint); // Update index if sort changed it
                calculateNaturalCubicSplineCoeffs(points);
            }

            const canvasPointCoords = worldToCanvas(targetPoint.x, targetPoint.y);
            dragReadoutInfo = {
                text: `X: ${targetPoint.x}, Y: ${targetPoint.y}`,
                x: canvasPointCoords.x + 10,
                y: canvasPointCoords.y - 10
            };

            if (currentCurveType === 'step') {
                points.sort((a, b) => a.x - b.x);
                selectedPointIndex = points.findIndex(p => p === targetPoint);
            } else if (currentCurveType === 'natural') {
                points.sort((a, b) => a.x - b.x);
                // After sorting, the selected point might have a new index if its x changed relative to others
                selectedPointIndex = points.findIndex(p => p === targetPoint);
            } else if (currentCurveType === 'naturalCubic') {
                // This block is redundant as sorting and findIndex for naturalCubic
                // is already handled above where calculateNaturalCubicSplineCoeffs is called.
                // points.sort((a,b) => a.x - b.x);
                // selectedPointIndex = points.findIndex(p => p === targetPoint); 
            }
            needsRedraw = true;

        } else if (draggingSegmentIndex !== -1 && currentCurveType === 'step') {
            let targetPoint = points[draggingSegmentIndex];
            const newWorldY = Math.round(worldMouseCoords.y);
            targetPoint.y = newWorldY;

            dragReadoutInfo = {
                text: `Y: ${targetPoint.y}`,
                x: mouseCanvasX + 15,
                y: mouseCanvasY - 15
            };
            needsRedraw = true;
        } else if (isPanningY || isPanningX) {
            console.log(`mousemove pan check: isPanningY=${isPanningY}, isPanningX=${isPanningX}`);
            const deltaY_canvas = mouseCanvasY - panStartY_canvas;
            const deltaX_canvas = mouseCanvasX - panStartX_canvas;

            let didYPan = false;
            let didXPan = false;

            if (isPanningY) {
                const worldDeltaY = (deltaY_canvas / (canvas.height - 2 * padding)) * (baseVisibleYRange / yZoomFactor);
                if (Math.abs(worldDeltaY) > 1e-3) {
                    yViewCenter = panStart_yViewCenter + worldDeltaY;
                    didYPan = true;
                }
            }

            console.log(`Before if(isPanningX): isPanningX=${isPanningX}`);
            if (isPanningX) {
                const visibleXRange = xMax / xZoomFactor;
                const worldDeltaX = (deltaX_canvas / (canvas.width - 2 * padding)) * (xMax / xZoomFactor);
                let newXViewCenter = panStart_xViewCenter - worldDeltaX;

                console.log(`isPanningX: deltaX_canvas=${deltaX_canvas.toFixed(2)}, worldDeltaX=${worldDeltaX.toFixed(2)}, panStart_xVC=${panStart_xViewCenter.toFixed(2)}, newXVC_before_clamp=${newXViewCenter.toFixed(2)}`);

                const minCenterX = visibleXRange / 2;
                const maxCenterX = xMax - visibleXRange / 2;

                let potentialXViewCenter = newXViewCenter;
                if (maxCenterX < minCenterX) {
                    potentialXViewCenter = xMax / 2;
                } else {
                    potentialXViewCenter = Math.max(minCenterX, Math.min(maxCenterX, newXViewCenter));
                }
                if (Math.abs(xViewCenter - potentialXViewCenter) > 1e-3) {
                    xViewCenter = potentialXViewCenter;
                    didXPan = true;
                }
                console.log(`Panning X: xViewCenter = ${xViewCenter.toFixed(2)}`);
            }

            if (didXPan && (!didYPan || Math.abs(deltaX_canvas) > Math.abs(deltaY_canvas) * 1.5)) {
                dragReadoutInfo = { text: `View X: ${xViewCenter.toFixed(1)}`, x: mouseCanvasX + 15, y: mouseCanvasY - 15 };
            } else if (didYPan) {
                dragReadoutInfo = { text: `View Y: ${yViewCenter.toFixed(1)}`, x: mouseCanvasX + 15, y: mouseCanvasY - 15 };
            } else if (dragReadoutInfo) {
            }

            if (didYPan || didXPan) {
                needsRedraw = true;
            }

        } else {
            if (dragReadoutInfo) {
                dragReadoutInfo = null;
                needsRedraw = true;
            }
            const oldHoveredPointIndex = hoveredPointIndex;
            const oldHoveredSegmentIndex = hoveredSegmentIndex;
            const oldHoveredSplineSegmentIndex = hoveredSplineSegmentIndex; // Store old spline hover
            const oldHoveredNaturalSegmentIndex = hoveredNaturalSegmentIndex; // Store old natural spline hover
            const oldHoveredNaturalCubicSegmentIndex = hoveredNaturalCubicSegmentIndex; // Store old natural cubic spline hover
            hoveredPointIndex = -1;
            hoveredSegmentIndex = -1;
            hoveredSplineSegmentIndex = -1; // Reset spline hover
            hoveredNaturalSegmentIndex = -1; // Reset natural spline hover
            hoveredNaturalCubicSegmentIndex = -1; // Reset natural cubic spline hover

            for (let i = 0; i < points.length; i++) {
                const canvasPoint = worldToCanvas(points[i].x, points[i].y);
                const dx = canvasPoint.x - mouseCanvasX;
                const dy = canvasPoint.y - mouseCanvasY;
                if (Math.sqrt(dx * dx + dy * dy) < 7) {
                    hoveredPointIndex = i;
                    break;
                }
            }

            if (hoveredPointIndex === -1 && currentCurveType === 'step') {
                for (let i = 0; i < points.length - 1; i++) {
                    const p1_canvas = worldToCanvas(points[i].x, points[i].y);
                    const p2_canvas_x = worldToCanvas(points[i + 1].x, points[i].y).x;

                    if (mouseCanvasX >= Math.min(p1_canvas.x, p2_canvas_x) &&
                        mouseCanvasX <= Math.max(p1_canvas.x, p2_canvas_x) &&
                        Math.abs(mouseCanvasY - p1_canvas.y) < 7) {
                        hoveredSegmentIndex = i;
                        break;
                    }
                }
            }

            // Spline segment hover detection (only if not hovering a point)
            if (hoveredPointIndex === -1 && currentCurveType === 'spline') {
                for (let i = 0; i < points.length - 2; i += 2) {
                    const p0 = points[i];
                    const c0 = points[i + 1];
                    const p1 = points[i + 2];

                    if (!p0 || !c0 || !p1 || p0.type !== 'anchor' || c0.type !== 'control' || p1.type !== 'anchor') {
                        continue;
                    }

                    // Check distance to this Bezier segment
                    const numSamples = 50; // Increased from 20
                    let minDistSq = Infinity;
                    for (let k = 0; k <= numSamples; k++) {
                        const t = k / numSamples;
                        const one_minus_t = 1 - t;

                        const x_t_world = one_minus_t * one_minus_t * p0.x + 2 * one_minus_t * t * c0.x + t * t * p1.x;
                        const y_t_world = one_minus_t * one_minus_t * p0.y + 2 * one_minus_t * t * c0.y + t * t * p1.y;

                        const canvasPt = worldToCanvas(x_t_world, y_t_world);
                        const dx = canvasPt.x - mouseCanvasX;
                        const dy = canvasPt.y - mouseCanvasY;
                        const distSq = dx * dx + dy * dy;
                        if (distSq < minDistSq) {
                            minDistSq = distSq;
                        }
                    }
                    if (minDistSq < 81) { // Increased from 64 (8px to 9px threshold)
                        hoveredSplineSegmentIndex = i; // Store index of the first anchor of the segment
                        break;
                    }
                }
            }

            // Natural spline segment hover detection (only if not hovering a point)
            if (hoveredPointIndex === -1 && currentCurveType === 'natural') {
                // Points are already sorted by X for natural splines during interaction/drawing
                const sortedPoints = points; // Or re-sort if necessary: [...points].sort((a,b)=>a.x-b.x);
                for (let i = 0; i < sortedPoints.length - 1; i++) {
                    const p1_world = sortedPoints[i];
                    const p2_world = sortedPoints[i + 1];
                    const p1_canvas = worldToCanvas(p1_world.x, p1_world.y);
                    const p2_canvas = worldToCanvas(p2_world.x, p2_world.y);

                    // Check distance from mouse to line segment (p1_canvas, p2_canvas)
                    // Using a common point-to-segment distance formula or approximation
                    const distSq = distToSegmentSquared(
                        { x: mouseCanvasX, y: mouseCanvasY },
                        p1_canvas,
                        p2_canvas
                    );

                    if (distSq < 49) { // Threshold, e.g., 7px radius
                        hoveredNaturalSegmentIndex = i; // Store index of the first point of the segment
                        break;
                    }
                }
            }

            // Natural Cubic Spline segment hover detection
            if (hoveredPointIndex === -1 && currentCurveType === 'naturalCubic') {
                const sortedPoints = [...points].sort((a, b) => a.x - b.x);
                if (sortedPoints.length >= 2 && naturalCubicCoeffs && naturalCubicCoeffs.a.length > 0) {
                    const { a, b, c, d } = naturalCubicCoeffs;
                    let closestSegmentIndex = -1;
                    let overallMinDistSq = Infinity;

                    for (let i = 0; i < sortedPoints.length - 1; i++) {
                        if (a[i] === undefined || b[i] === undefined || c[i] === undefined || d[i] === undefined) {
                            // console.warn("Skipping segment in hover due to missing coeffs:", i);
                            continue; // Skip if coefficients are missing for this segment
                        }

                        const p1_world = sortedPoints[i];
                        const p2_world = sortedPoints[i + 1];
                        const x0_world = p1_world.x;
                        const y0_world_coeff = a[i]; // This is y-value of p1_world from coefficients

                        const numSamples = 50; // Increased from 30 samples along the cubic curve segment
                        let segmentMinDistSq = Infinity;

                        for (let k = 0; k <= numSamples; k++) {
                            const t = k / numSamples;
                            const currentX_world = x0_world + t * (p2_world.x - x0_world);
                            const deltaX_world = currentX_world - x0_world;

                            const interpolatedY_world = y0_world_coeff +
                                b[i] * deltaX_world +
                                c[i] * Math.pow(deltaX_world, 2) +
                                d[i] * Math.pow(deltaX_world, 3);

                            const canvasPt = worldToCanvas(currentX_world, interpolatedY_world);
                            const dx_mouse = canvasPt.x - mouseCanvasX;
                            const dy_mouse = canvasPt.y - mouseCanvasY;
                            const distSq_mouse = dx_mouse * dx_mouse + dy_mouse * dy_mouse;

                            if (distSq_mouse < segmentMinDistSq) {
                                segmentMinDistSq = distSq_mouse;
                            }
                        }

                        // If this segment is closer than any previous, update overallMinDistSq and closestSegmentIndex
                        if (segmentMinDistSq < overallMinDistSq) {
                            overallMinDistSq = segmentMinDistSq;
                            closestSegmentIndex = i;
                        }
                    }

                    // If the closest found segment is within the threshold, set it as hovered
                    if (overallMinDistSq < 64) { // Threshold (e.g., 8px radius squared, increased from 7px)
                        hoveredNaturalCubicSegmentIndex = closestSegmentIndex;
                    }
                }
            }

            if (hoveredPointIndex !== oldHoveredPointIndex ||
                hoveredSegmentIndex !== oldHoveredSegmentIndex ||
                hoveredSplineSegmentIndex !== oldHoveredSplineSegmentIndex ||
                hoveredNaturalSegmentIndex !== oldHoveredNaturalSegmentIndex || // Check natural spline hover change
                hoveredNaturalCubicSegmentIndex !== oldHoveredNaturalCubicSegmentIndex) { // Check natural cubic spline hover change
                needsRedraw = true;
            }
        }

        if (!needsRedraw && dragReadoutInfo && dragReadoutInfo.text !== currentDragReadoutText) {
            needsRedraw = true;
        }
        if (!needsRedraw && !dragReadoutInfo && currentDragReadoutText !== null) {
            needsRedraw = true;
        }

        if (needsRedraw) {
            draw();
        }
    });

    canvas.addEventListener('mouseup', (e) => {
        let needsRedrawForClear = false;
        if (isDraggingPoint || draggingSegmentIndex !== -1 || isPanningY || isPanningX) {
            if (dragReadoutInfo) {
                dragReadoutInfo = null;
                needsRedrawForClear = true;
            }
        }

        if (isDraggingPoint) {
            if (currentCurveType === 'step') {
                points.sort((a, b) => a.x - b.x);
            }
        }
        isDraggingPoint = false;
        draggingSegmentIndex = -1;
        isPanningY = false;
        isPanningX = false;
        linkedPartnersInfo = []; // Clear C1 drag info
        draggedAnchorInfo = null; // Clear dragged anchor C1 info

        if (needsRedrawForClear) {
            draw();
        }
    });

    canvas.addEventListener('mouseleave', (e) => {
        let needsRedraw = false;
        if (isDraggingPoint || draggingSegmentIndex !== -1 || isPanningY || isPanningX) {
            isDraggingPoint = false;
            draggingSegmentIndex = -1;
            isPanningY = false;
            isPanningX = false;
            if (dragReadoutInfo) {
                dragReadoutInfo = null;
            }
            linkedPartnersInfo = []; // Clear C1 drag info
            draggedAnchorInfo = null; // Clear dragged anchor C1 info
            needsRedraw = true;
        }
        if (hoveredPointIndex !== -1 || hoveredSegmentIndex !== -1 || hoveredSplineSegmentIndex !== -1 || hoveredNaturalSegmentIndex !== -1 || hoveredNaturalCubicSegmentIndex !== -1) {
            hoveredPointIndex = -1;
            hoveredSegmentIndex = -1;
            hoveredSplineSegmentIndex = -1;
            hoveredNaturalSegmentIndex = -1; // Reset natural spline hover
            hoveredNaturalCubicSegmentIndex = -1; // Reset natural cubic hover
            needsRedraw = true;
        }
        if (needsRedraw) {
            draw();
        }
    });

    canvas.addEventListener('dblclick', (e) => {
        const mouseCanvasX = e.offsetX;
        const mouseCanvasY = e.offsetY;
        const worldMouseCoords = canvasToWorld(mouseCanvasX, mouseCanvasY);
        let needsRedraw = false;

        if (currentCurveType === 'step') {
            if (hoveredPointIndex !== -1 && hoveredPointIndex !== 0 && hoveredPointIndex !== points.length - 1) {
                points.splice(hoveredPointIndex, 1);
                selectedPointIndex = -1;
                hoveredPointIndex = -1;
                hoveredSegmentIndex = -1;
                points.sort((a, b) => a.x - b.x);
                needsRedraw = true;
            }
            else if (hoveredSegmentIndex !== -1 && hoveredPointIndex === -1) {
                const p1 = points[hoveredSegmentIndex];
                const p2 = points[hoveredSegmentIndex + 1];

                const newPointX = Math.round(worldMouseCoords.x);
                if (newPointX > p1.x && newPointX < p2.x) {
                    const newPoint = { x: newPointX, y: p1.y };
                    points.push(newPoint);
                    points.sort((a, b) => a.x - b.x);
                    selectedPointIndex = points.findIndex(p => p.x === newPoint.x && p.y === newPoint.y);
                    hoveredPointIndex = selectedPointIndex;
                    hoveredSegmentIndex = -1;
                    needsRedraw = true;
                }
            }
        } else if (currentCurveType === 'spline') {
            if (hoveredPointIndex !== -1) { // If a point is hovered
                // Prevent deletion of start (A0) or end (An) anchors
                if (hoveredPointIndex === 0 || hoveredPointIndex === points.length - 1) {
                    console.log("Cannot remove start or end anchor point of spline.");
                    // Optionally, allow dblclick on control points of A0/An to reset them? Or do nothing.
                } else {
                    // Deleting an intermediate point (either an anchor A_i or a control C_i)
                    const pointToRemove = points[hoveredPointIndex];
                    const originalHoveredIndex = hoveredPointIndex; // Store before splice changes indices

                    if (pointToRemove.type === 'control') {
                        // Deleting a control point C_i.
                        // C_i is at points[originalHoveredIndex]. Its anchors are A_i and A_{i+1}.
                        // A_i is at points[originalHoveredIndex - 1]
                        // A_{i+1} is at points[originalHoveredIndex + 1]
                        const leftAnchor = points[originalHoveredIndex - 1];
                        const rightAnchor = points[originalHoveredIndex + 1];

                        points.splice(originalHoveredIndex, 1); // Remove the control point

                        // Insert new control point at midpoint of its former anchors
                        if (leftAnchor && rightAnchor) {
                            let newMidControlX = Math.round((leftAnchor.x + rightAnchor.x) / 2);
                            const newMidControlY = Math.round((leftAnchor.y + rightAnchor.y) / 2);
                            // X-Clamp the new mid control point
                            const minAnchorX = Math.min(leftAnchor.x, rightAnchor.x);
                            const maxAnchorX = Math.max(leftAnchor.x, rightAnchor.x);
                            newMidControlX = Math.max(minAnchorX, Math.min(maxAnchorX, newMidControlX));

                            const newMidControl = { x: newMidControlX, y: newMidControlY, type: 'control' };
                            points.splice(originalHoveredIndex, 0, newMidControl); // Insert at same index C was removed from
                            ensureC1ContinuityAfterChange(originalHoveredIndex); // Ensure C1 for new control
                        }
                        needsRedraw = true;
                    } else if (pointToRemove.type === 'anchor') {
                        // Deleting an intermediate anchor A_k.
                        // A_k must be between A_{k-1} and A_{k+1}.
                        // Structure: A_{k-1}, C_{k-1}, A_k, C_k, A_{k+1}
                        // Indices:   idx-2,   idx-1,  idx, idx+1, idx+2
                        // We need to remove C_{k-1}, A_k, C_k and bridge A_{k-1} and A_{k+1} with a new control point.
                        // Condition to ensure it's a deletable intermediate anchor:
                        if (hoveredPointIndex >= 2 && hoveredPointIndex <= points.length - 3 && (hoveredPointIndex % 2 === 0)) {
                            const anchor_k_minus_1 = points[hoveredPointIndex - 2]; // This is A_{k-1}
                            const anchor_k_plus_1 = points[hoveredPointIndex + 2]; // This is A_{k+1}

                            points.splice(hoveredPointIndex - 1, 3); // Removes C_{k-1}, A_k, C_k

                            // After splice, anchor_k_minus_1 is effectively at points[hoveredPointIndex - 2]
                            // and anchor_k_plus_1 is effectively at points[hoveredPointIndex - 1]
                            // (using original hoveredPointIndex for conceptual mapping before array length change)

                            // Create a new control point between A_{k-1} and A_{k+1}
                            const new_control_x = Math.round((anchor_k_minus_1.x + anchor_k_plus_1.x) / 2);
                            const new_control_y = Math.round((anchor_k_minus_1.y + anchor_k_plus_1.y) / 2);
                            let new_control = { x: new_control_x, y: new_control_y, type: 'control' };

                            // X-Clamp the new control point
                            const minAnchorX = Math.min(anchor_k_minus_1.x, anchor_k_plus_1.x);
                            const maxAnchorX = Math.max(anchor_k_minus_1.x, anchor_k_plus_1.x);
                            new_control.x = Math.max(minAnchorX, Math.min(maxAnchorX, new_control.x));

                            // Insert the new control point between the two anchors that were bridged by the deleted anchor.
                            // The first of these anchors is at index (hoveredPointIndex - 2).
                            // So the new control should go at (hoveredPointIndex - 2) + 1 = hoveredPointIndex - 1
                            points.splice(hoveredPointIndex - 1, 0, new_control);
                            ensureC1ContinuityAfterChange(hoveredPointIndex - 1); // Pass index of new_control
                            needsRedraw = true;
                        } else {
                            console.log("Error: Attempted to delete a non-intermediate anchor or an anchor in a too-short spline for this operation.");
                        }
                    }

                    // Common post-deletion structural fix & cleanup 
                    // Ensure minimum spline structure (A0-C0-A1) if points become too few
                    if (points.length === 2 && points[0].type === 'anchor' && points[1].type === 'anchor') {
                        // We have A0, A1. Need to insert C0.
                        const p0_check = points[0];
                        const p1_check = points[1];
                        const defaultCx = Math.round((p0_check.x + p1_check.x) / 2);
                        const defaultCy = Math.round((p0_check.y + p1_check.y) / 2);
                        points.splice(1, 0, { x: defaultCx, y: defaultCy, type: 'control' });
                        // No need for C1 here as it's the only control point.
                    }

                    // Re-validate structure and types (A, C, A, C, ..., A) and endpoints
                    if (points.length > 0) {
                        for (let i = 0; i < points.length; i++) {
                            points[i].type = (i % 2 === 0) ? 'anchor' : 'control';
                        }
                        // Ensure endpoints are anchors and at bounds
                        points[0].x = 0;
                        points[0].type = 'anchor';
                        points[points.length - 1].x = xMax;
                        points[points.length - 1].type = 'anchor';
                    } else { // If all points were somehow deleted, reset to default A0-C0-A1
                        points.push({ x: 0, y: getDefaultY(), type: 'anchor' });
                        points.push({ x: Math.round(xMax / 2), y: getDefaultY(), type: 'control' });
                        points.push({ x: xMax, y: getDefaultY(), type: 'anchor' });
                        needsRedraw = true;
                    }
                }
                selectedPointIndex = -1; // Deselect after operation
                hoveredPointIndex = -1;  // Clear hover
                needsRedraw = true; // Ensure redraw after any dblclick on point
            } else if (hoveredSplineSegmentIndex !== -1 && hoveredPointIndex === -1) { // If a segment is hovered (and not a point)
                // Add a new anchor point in the middle of the hovered segment.
                // This means splitting A_i --- C_i --- A_{i+1} into A_i -- C_new1 -- A_new -- C_new2 -- A_{i+1}
                const segStartAnchorIdx = hoveredSplineSegmentIndex;
                const controlIdx = segStartAnchorIdx + 1;
                const segEndAnchorIdx = segStartAnchorIdx + 2;

                if (points[segStartAnchorIdx] && points[controlIdx] && points[segEndAnchorIdx] &&
                    points[segStartAnchorIdx].type === 'anchor' &&
                    points[controlIdx].type === 'control' &&
                    points[segEndAnchorIdx].type === 'anchor') {

                    const A_i = points[segStartAnchorIdx];
                    const C_i = points[controlIdx];     // Original control point
                    const A_ip1 = points[segEndAnchorIdx];

                    // New anchor A_new will be at the (t=0.5) position of the quadratic Bezier segment
                    // B(0.5) = 0.25*A_i + 0.5*C_i + 0.25*A_ip1
                    const A_new_x = Math.round(0.25 * A_i.x + 0.5 * C_i.x + 0.25 * A_ip1.x);
                    const A_new_y = Math.round(0.25 * A_i.y + 0.5 * C_i.y + 0.25 * A_ip1.y);
                    const A_new = { x: A_new_x, y: A_new_y, type: 'anchor' };

                    // New control points C_new1 and C_new2
                    // C_new1 is between A_i and A_new. Midpoint for simplicity.
                    let C_new1_x = Math.round((A_i.x + A_new.x) / 2);
                    const C_new1_y = Math.round((A_i.y + A_new.y) / 2);
                    // Clamp X for C_new1 between A_i.x and A_new.x
                    C_new1_x = Math.max(Math.min(A_i.x, A_new.x), Math.min(Math.max(A_i.x, A_new.x), C_new1_x));


                    // C_new2 is between A_new and A_ip1. Midpoint for simplicity.
                    let C_new2_x = Math.round((A_new.x + A_ip1.x) / 2);
                    const C_new2_y = Math.round((A_new.y + A_ip1.y) / 2);
                    // Clamp X for C_new2 between A_new.x and A_ip1.x
                    C_new2_x = Math.max(Math.min(A_new.x, A_ip1.x), Math.min(Math.max(A_new.x, A_ip1.x), C_new2_x));

                    const C_new1 = { x: C_new1_x, y: C_new1_y, type: 'control' };
                    const C_new2 = { x: C_new2_x, y: C_new2_y, type: 'control' };

                    // Replace C_i with C_new1, A_new, C_new2
                    // Original sequence: ... A_i, C_i, A_ip1 ... (C_i is at controlIdx)
                    // New sequence: ... A_i, C_new1, A_new, C_new2, A_ip1 ...
                    points.splice(controlIdx, 1, C_new1, A_new, C_new2);

                    // Ensure C1 continuity around the new structure
                    // The new anchor A_new is at points[controlIdx + 1] after splice
                    // C_new1 is at points[controlIdx]
                    // C_new2 is at points[controlIdx + 2]
                    ensureC1ContinuityAfterChange(controlIdx);       // C1 involving C_new1 and its neighbors
                    ensureC1ContinuityAfterChange(controlIdx + 2);   // C1 involving C_new2 and its neighbors

                    needsRedraw = true;
                }
                hoveredSplineSegmentIndex = -1; // Clear segment hover
            }
        }
        if (hoveredPointIndex !== -1) {
            if (hoveredPointIndex === 0 || hoveredPointIndex === points.length - 1) {
                console.log("Cannot remove start or end anchor point of spline.");
            } else {
                const pointToRemove = points[hoveredPointIndex];
                const originalHoveredIndex = hoveredPointIndex; // Store before splice changes indices

                if (pointToRemove.type === 'control') {
                    const leftAnchor = points[originalHoveredIndex - 1];
                    const rightAnchor = points[originalHoveredIndex + 1];

                    points.splice(originalHoveredIndex, 1); // Remove the control point

                    // Insert new control point at midpoint of its former anchors
                    if (leftAnchor && rightAnchor) {
                        let newMidControlX = Math.round((leftAnchor.x + rightAnchor.x) / 2);
                        const newMidControlY = Math.round((leftAnchor.y + rightAnchor.y) / 2);
                        // X-Clamp the new mid control point
                        const minAnchorX = Math.min(leftAnchor.x, rightAnchor.x);
                        const maxAnchorX = Math.max(leftAnchor.x, rightAnchor.x);
                        newMidControlX = Math.max(minAnchorX, Math.min(maxAnchorX, newMidControlX));

                        const newMidControl = { x: newMidControlX, y: newMidControlY, type: 'control' };
                        points.splice(originalHoveredIndex, 0, newMidControl); // Insert at same index C was removed from
                        ensureC1ContinuityAfterChange(originalHoveredIndex);
                    }
                    needsRedraw = true;
                } else if (pointToRemove.type === 'anchor') {
                    // Condition to ensure it's a deletable intermediate anchor:
                    // It must have A_{k-1} and A_{k+1} as distinct anchors around it.
                    // Indices: A_{k-1} (idx-2), C_{k-1} (idx-1), A_k (idx), C_k (idx+1), A_{k+1} (idx+2)
                    if (hoveredPointIndex >= 2 && hoveredPointIndex <= points.length - 3 && (hoveredPointIndex % 2 === 0)) {
                        const anchor_k_minus_1 = points[hoveredPointIndex - 2];
                        const anchor_k_plus_1 = points[hoveredPointIndex + 2];

                        points.splice(hoveredPointIndex - 1, 3); // Removes C_{k-1}, A_k, C_k

                        // After splice, anchor_k_minus_1 is effectively at points[hoveredPointIndex - 2]
                        // and anchor_k_plus_1 is effectively at points[hoveredPointIndex - 1]
                        // (using original hoveredPointIndex for conceptual mapping before array length change)

                        const new_control_x = Math.round((anchor_k_minus_1.x + anchor_k_plus_1.x) / 2);
                        const new_control_y = Math.round((anchor_k_minus_1.y + anchor_k_plus_1.y) / 2);
                        let new_control = { x: new_control_x, y: new_control_y, type: 'control' };

                        // X-Clamp the new control point
                        const minAnchorX = Math.min(anchor_k_minus_1.x, anchor_k_plus_1.x);
                        const maxAnchorX = Math.max(anchor_k_minus_1.x, anchor_k_plus_1.x);
                        new_control.x = Math.max(minAnchorX, Math.min(maxAnchorX, new_control.x));

                        // Insert the new control point between the two anchors that were bridged by the deleted anchor.
                        // The first of these anchors is at index (hoveredPointIndex - 2).
                        points.splice(hoveredPointIndex - 1, 0, new_control);
                        ensureC1ContinuityAfterChange(hoveredPointIndex - 1); // Pass index of new_control
                        needsRedraw = true;
                    } else {
                        console.log("Error: Attempted to delete a non-intermediate anchor or an anchor in a too-short spline for this operation.");
                    }
                }

                // Common post-deletion structural fix & cleanup 
                if (points.length === 2) {
                    const p0_check = points[0];
                    const p1_check = points[1];
                    const defaultCx = Math.round((p0_check.x + p1_check.x) / 2);
                    const defaultCy = Math.round((p0_check.y + p1_check.y) / 2);
                    points.splice(1, 0, { x: defaultCx, y: defaultCy, type: 'control' });
                }

                if (points.length > 0) {
                    for (let i = 0; i < points.length; i++) {
                        points[i].type = (i % 2 === 0) ? 'anchor' : 'control';
                    }
                    points[0].x = 0;
                    points[0].type = 'anchor';
                    points[points.length - 1].x = xMax;
                    points[points.length - 1].type = 'anchor';
                } else {
                    points.push({ x: 0, y: getDefaultY(), type: 'anchor' });
                    points.push({ x: Math.round(xMax / 2), y: getDefaultY(), type: 'control' });
                    points.push({ x: xMax, y: getDefaultY(), type: 'anchor' });
                    needsRedraw = true;
                }
            }
        }
        else if (currentCurveType === 'natural') {
            if (hoveredPointIndex !== -1) {
                // Cannot remove start (0) or end (points.length - 1) point
                if (hoveredPointIndex > 0 && hoveredPointIndex < points.length - 1) {
                    points.splice(hoveredPointIndex, 1);
                    selectedPointIndex = -1;
                    hoveredPointIndex = -1;
                    hoveredNaturalSegmentIndex = -1; // Clear segment hover too
                    // Points are already sorted by x due to drag logic, but re-sort for safety if manual edits occur
                    points.sort((a, b) => a.x - b.x);
                    needsRedraw = true;
                }
            } else if (hoveredNaturalSegmentIndex !== -1) {
                const p1 = points[hoveredNaturalSegmentIndex];
                const p2 = points[hoveredNaturalSegmentIndex + 1];

                // Ensure p1 and p2 exist (should always be true if hoveredNaturalSegmentIndex is valid)
                if (!p1 || !p2) {
                    console.error("Cannot find points for segment splitting in natural spline.");
                    return;
                }

                let newPointX = Math.round(worldMouseCoords.x);

                // Ensure newPointX is strictly between p1.x and p2.x
                // And give it a small buffer if p1.x and p2.x are too close
                if (newPointX <= p1.x) newPointX = p1.x + 1;
                if (newPointX >= p2.x) newPointX = p2.x - 1;

                if (newPointX > p1.x && newPointX < p2.x) { // Only add if there's space
                    // Linear interpolation for Y
                    let newPointY = p1.y; // Default to p1.y if segment is vertical or p1.x === p2.x
                    if (p2.x !== p1.x) { // Avoid division by zero
                        newPointY = p1.y + (newPointX - p1.x) * (p2.y - p1.y) / (p2.x - p1.x);
                    }
                    newPointY = Math.round(newPointY);

                    const newPoint = { x: newPointX, y: newPointY, type: 'anchor' };
                    points.push(newPoint);
                    points.sort((a, b) => a.x - b.x);

                    selectedPointIndex = points.findIndex(p => p.x === newPoint.x && p.y === newPoint.y);
                    hoveredPointIndex = selectedPointIndex;
                    hoveredNaturalSegmentIndex = -1; // Clear segment hover
                    needsRedraw = true;
                }
            }
        } else if (currentCurveType === 'naturalCubic') {
            if (hoveredPointIndex !== -1) {
                if (hoveredPointIndex > 0 && hoveredPointIndex < points.length - 1) {
                    points.splice(hoveredPointIndex, 1);
                    selectedPointIndex = -1;
                    hoveredPointIndex = -1;
                    hoveredNaturalCubicSegmentIndex = -1;
                    points.sort((a, b) => a.x - b.x);
                    // TODO: Recalculate naturalCubicCoeffs
                    calculateNaturalCubicSplineCoeffs(points);
                    needsRedraw = true;
                }
            } else if (hoveredNaturalCubicSegmentIndex !== -1) {
                const p1 = points[hoveredNaturalCubicSegmentIndex];
                const p2 = points[hoveredNaturalCubicSegmentIndex + 1];

                if (!p1 || !p2) {
                    console.error("Cannot find points for segment splitting in natural cubic spline.");
                    return;
                }
                let newPointX = Math.round(worldMouseCoords.x);
                if (newPointX <= p1.x) newPointX = p1.x + 1;
                if (newPointX >= p2.x) newPointX = p2.x - 1;

                if (newPointX > p1.x && newPointX < p2.x) {
                    // Calculate Y using the actual spline equation for the segment
                    let newPointY = p1.y; // Default if coeffs are somehow unavailable
                    if (naturalCubicCoeffs && naturalCubicCoeffs.a.length > hoveredNaturalCubicSegmentIndex) {
                        const i = hoveredNaturalCubicSegmentIndex;
                        const x0_segment = points[i].x; // X-coordinate of the start of the segment
                        const a_coeff = naturalCubicCoeffs.a[i];
                        const b_coeff = naturalCubicCoeffs.b[i];
                        const c_coeff = naturalCubicCoeffs.c[i];
                        const d_coeff = naturalCubicCoeffs.d[i];

                        if (a_coeff !== undefined && b_coeff !== undefined && c_coeff !== undefined && d_coeff !== undefined) {
                            const deltaX = newPointX - x0_segment;
                            newPointY = a_coeff +
                                b_coeff * deltaX +
                                c_coeff * Math.pow(deltaX, 2) +
                                d_coeff * Math.pow(deltaX, 3);
                        } else {
                            // Fallback to linear interpolation if specific coeffs are missing (should be rare)
                            if (p2.x !== p1.x) {
                                newPointY = p1.y + (newPointX - p1.x) * (p2.y - p1.y) / (p2.x - p1.x);
                            }
                        }
                    } else {
                        // Fallback to linear interpolation if coeffs object is missing (should be very rare)
                        if (p2.x !== p1.x) {
                            newPointY = p1.y + (newPointX - p1.x) * (p2.y - p1.y) / (p2.x - p1.x);
                        }
                    }
                    newPointY = Math.round(newPointY);

                    const newPoint = { x: newPointX, y: newPointY, type: 'anchor' };
                    points.push(newPoint);
                    points.sort((a, b) => a.x - b.x);
                    // TODO: Recalculate naturalCubicCoeffs
                    calculateNaturalCubicSplineCoeffs(points);
                    selectedPointIndex = points.findIndex(p => p.x === newPoint.x && p.y === newPoint.y);
                    hoveredPointIndex = selectedPointIndex;
                    hoveredNaturalCubicSegmentIndex = -1;
                    needsRedraw = true;
                }
            }
        }

        if (needsRedraw) {
            draw();
        }
    });

    // Initial setup
    window.addEventListener('resize', resizeCanvas);
    xMax = Math.round(parseFloat(xMaxInput.value));

    function applyC1Smoothing(controlToAdjustIdx, pivotAnchorIdx, refControlIdx) {
        // Ensure all involved points exist and are of the correct type
        if (!points[controlToAdjustIdx] || points[controlToAdjustIdx].type !== 'control' ||
            !points[pivotAnchorIdx] || points[pivotAnchorIdx].type !== 'anchor' ||
            !points[refControlIdx] || points[refControlIdx].type !== 'control') {
            // console.warn("Invalid points for C1 smoothing", controlToAdjustIdx, pivotAnchorIdx, refControlIdx, points);
            return;
        }

        const cpToAdjust = points[controlToAdjustIdx];
        const pivot = points[pivotAnchorIdx];
        const refCp = points[refControlIdx];

        // Calculate vector from pivot to reference control point
        const dx_vec = refCp.x - pivot.x;
        const dy_vec = refCp.y - pivot.y;
        const len_vec = Math.sqrt(dx_vec * dx_vec + dy_vec * dy_vec);

        // Store original distance from cpToAdjust to pivot
        const originalDist = Math.sqrt(Math.pow(cpToAdjust.x - pivot.x, 2) + Math.pow(cpToAdjust.y - pivot.y, 2));

        if (len_vec > 1e-5 && originalDist > 1e-5) { // Avoid division by zero or if points are coincident
            const norm_dx = dx_vec / len_vec;
            const norm_dy = dy_vec / len_vec;

            // Position cpToAdjust opposite to refCp relative to pivot, maintaining originalDist
            cpToAdjust.x = Math.round(pivot.x - norm_dx * originalDist);
            cpToAdjust.y = Math.round(pivot.y - norm_dy * originalDist);

            // X-clamp cpToAdjust between its own anchors
            // cpToAdjust is points[controlToAdjustIdx]. Its anchors are at [controlToAdjustIdx-1] and [controlToAdjustIdx+1]
            const ownAnchorLeft = points[controlToAdjustIdx - 1];
            const ownAnchorRight = points[controlToAdjustIdx + 1];

            if (ownAnchorLeft && ownAnchorRight && ownAnchorLeft.type === 'anchor' && ownAnchorRight.type === 'anchor') {
                const minAnchorX = Math.min(ownAnchorLeft.x, ownAnchorRight.x);
                const maxAnchorX = Math.max(ownAnchorLeft.x, ownAnchorRight.x);
                cpToAdjust.x = Math.max(minAnchorX, Math.min(maxAnchorX, cpToAdjust.x));
            } else {
                // This control point doesn't have two valid anchors, which is unusual for an adjustable control point.
                // console.warn("C1 Smoothing: Control point to adjust is missing one or both of its direct anchors for X-clamping.", cpToAdjust);
            }
        } else if (len_vec <= 1e-5 && originalDist > 1e-5) {
            // refCp is coincident with pivot. Place cpToAdjust horizontally from pivot.
            // (This is a fallback; ideally, refCp and pivot aren't coincident for C1)
            // Keep current Y, extend horizontally by originalDist on the other side.
            // No clear "other side" if refCp is on pivot. Let's assume left for now.
            // This part might need better definition if common.
            cpToAdjust.x = Math.round(pivot.x - originalDist); // Or + originalDist, or based on some other rule
            // cpToAdjust.y = pivot.y; // Could also align Y
            // And then clamp X as above.
        }
        // If originalDist is near zero, cpToAdjust is already on the pivot, do nothing.
    }

    function ensureC1ContinuityAfterChange(changedOrNewControlIdx) {
        // This function is called when a control point (changedOrNewControlIdx) is moved OR
        // when a new control point is created (e.g., after deleting an anchor).
        // It tries to adjust the *other* control points around the anchors adjacent to changedOrNewControlIdx.

        if (!points[changedOrNewControlIdx] || points[changedOrNewControlIdx].type !== 'control') {
            // console.warn("ensureC1Continuity: Invalid or non-control point index provided", changedOrNewControlIdx);
            return;
        }

        const controlPoint = points[changedOrNewControlIdx];

        // 1. Check the anchor to the LEFT of the changed control point (if it exists and is not A0)
        // Structure: C_far_left --- A_left --- controlPoint (changed)
        const leftAnchorIdx = changedOrNewControlIdx - 1;
        if (leftAnchorIdx > 0) { // Ensure A_left is not A0 (A0 has no control point to its left)
            const leftAnchor = points[leftAnchorIdx];
            const farLeftControlIdx = leftAnchorIdx - 1; // This is C_far_left

            if (leftAnchor && leftAnchor.type === 'anchor' &&
                points[farLeftControlIdx] && points[farLeftControlIdx].type === 'control') {
                // Apply smoothing: adjust farLeftControlIdx based on controlPoint relative to leftAnchor
                applyC1Smoothing(farLeftControlIdx, leftAnchorIdx, changedOrNewControlIdx);
            }
        }

        // 2. Check the anchor to the RIGHT of the changed control point (if it exists and is not An)
        // Structure: controlPoint (changed) --- A_right --- C_far_right
        const rightAnchorIdx = changedOrNewControlIdx + 1;
        if (rightAnchorIdx < points.length - 1) { // Ensure A_right is not An (An has no control point to its right)
            const rightAnchor = points[rightAnchorIdx];
            const farRightControlIdx = rightAnchorIdx + 1; // This is C_far_right

            if (rightAnchor && rightAnchor.type === 'anchor' &&
                points[farRightControlIdx] && points[farRightControlIdx].type === 'control') {
                // Apply smoothing: adjust farRightControlIdx based on controlPoint relative to rightAnchor
                applyC1Smoothing(farRightControlIdx, rightAnchorIdx, changedOrNewControlIdx);
            }
        }
    }

    xMaxInput.value = xMax;

    yZoomSlider.addEventListener('input', (e) => {
        yZoomFactor = parseFloat(e.target.value);
        yZoomValueDisplay.textContent = yZoomFactor.toFixed(2);
        draw();
    });

    xZoomSlider.addEventListener('input', (e) => {
        xZoomFactor = parseFloat(e.target.value);
        xZoomValueDisplay.textContent = xZoomFactor.toFixed(1);
        const visibleXRange = xMax / xZoomFactor;
        xViewCenter = Math.max(visibleXRange / 2, Math.min(xMax - visibleXRange / 2, xViewCenter));
        draw();
    });

    resetViewButton.addEventListener('click', () => {
        if (currentCurveType === 'spline') {
            yViewCenter = 0;
            baseVisibleYRange = 2000; // Ensure this is set if it can change
        } else if (currentCurveType === 'step') {
            yViewCenter = 495;
            baseVisibleYRange = 1010; // Ensure this is set
        } else if (currentCurveType === 'natural') {
            // Set Y-range (can be same as spline or specific)
            yViewCenter = 0;
            baseVisibleYRange = 2000;
            // For natural spline, reset to two anchor points
            const defaultY = 0;
            points = [
                { x: 0, y: defaultY, type: 'anchor' },
                { x: xMax, y: defaultY, type: 'anchor' }
            ];
            points.sort((a, b) => a.x - b.x);
            calculateNaturalCubicSplineCoeffs(points); // Removed TODO and added the call
        } else if (currentCurveType === 'naturalCubic') {
            yViewCenter = 0;
            baseVisibleYRange = 2000;
            const defaultY = 0;
            points = [
                { x: 0, y: defaultY, type: 'anchor' },
                { x: xMax, y: defaultY, type: 'anchor' }
            ];
            points.sort((a, b) => a.x - b.x);
            // TODO: Recalculate naturalCubicCoeffs 
            calculateNaturalCubicSplineCoeffs(points); // Added this line
        }
        yZoomFactor = 1;
        yZoomSlider.value = yZoomFactor;
        yZoomValueDisplay.textContent = yZoomFactor.toFixed(2);

        xViewCenter = xMax / 2;
        xZoomFactor = 1;
        xZoomSlider.value = xZoomFactor;
        xZoomValueDisplay.textContent = xZoomFactor.toFixed(1);
        draw();
    });

    yZoomValueDisplay.textContent = parseFloat(yZoomSlider.value).toFixed(2);
    yZoomFactor = parseFloat(yZoomSlider.value);
    xZoomValueDisplay.textContent = parseFloat(xZoomSlider.value).toFixed(1);
    xZoomFactor = parseFloat(xZoomSlider.value);

    xViewCenter = xMax / 2;
    yViewCenter = 0;

    // Initial setup for default spline type
    currentCurveType = 'spline'; // Ensure it is spline
    curveTypeSelect.value = 'spline';
    baseVisibleYRange = 2000;
    let initialSplineY = 0;
    points = [
        { x: 0, y: initialSplineY, type: 'anchor' },
        { x: Math.round(xMax / 2), y: initialSplineY, type: 'control' },
        { x: xMax, y: initialSplineY, type: 'anchor' }
    ];

    xViewCenter = xMax / 2;

    loadGraphButton.addEventListener('click', () => {
        loadFileInput.click();
    });

    loadFileInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (!file) {
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const loadedData = JSON.parse(e.target.result);

                if (typeof loadedData.curveType !== 'string' ||
                    typeof loadedData.xMax !== 'number' ||
                    !Array.isArray(loadedData.points)) {
                    alert('Invalid file format.');
                    return;
                }

                currentCurveType = loadedData.curveType;
                xMax = loadedData.xMax;
                points = loadedData.points.map(p => ({
                    x: Math.round(parseFloat(p.x)),
                    y: Math.round(parseFloat(p.y))
                }));

                curveTypeSelect.value = currentCurveType;
                xMaxInput.value = xMax;

                // Set filename input from loaded file
                const justFileName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
                filenameInput.value = justFileName;

                resetViewButton.click();
                draw();

            } catch (error) {
                console.error("Error loading or parsing file:", error);
                alert("Failed to load file. Make sure it is a valid JSON graph file.");
            }
        };
        reader.onerror = () => {
            console.error("FileReader error");
            alert("Error reading file.");
        };
        reader.readAsText(file);
        loadFileInput.value = null;
    });

    downloadGraphButton.addEventListener('click', () => {
        const graphData = {
            curveType: currentCurveType,
            xMax: xMax,
            points: points
        };
        const jsonString = JSON.stringify(graphData, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });

        let baseName = filenameInput.value.trim();
        if (!baseName) {
            baseName = currentCurveType + "_graph";
            filenameInput.value = baseName;
        }
        const suggestedName = baseName + ".json";

        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = suggestedName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
    });

    downloadCsvButton.addEventListener('click', () => {
        let csvContent = "# x, y\n"; // Header

        for (let x = 0; x <= xMax; x++) {
            const y = getSampledYatX(x, currentCurveType, points);
            csvContent += `${Math.round(x)},${Math.round(y)}\n`;
        }

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });

        let baseName = filenameInput.value.trim();
        if (!baseName) {
            baseName = currentCurveType + "_samples";
            filenameInput.value = baseName;
        }
        const suggestedName = baseName + ".csv";

        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = suggestedName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
    });

    resizeCanvas();
});

// Helper function for point to line segment distance squared
function distToSegmentSquared(p, v, w) {
    const l2 = (v.x - w.x) * (v.x - w.x) + (v.y - w.y) * (v.y - w.y);
    if (l2 === 0) return (p.x - v.x) * (p.x - v.x) + (p.y - v.y) * (p.y - v.y); // v == w case
    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    const projX = v.x + t * (w.x - v.x);
    const projY = v.y + t * (w.y - v.y);
    return (p.x - projX) * (p.x - projX) + (p.y - projY) * (p.y - projY);
}

// Initial setup
window.addEventListener('resize', resizeCanvas);