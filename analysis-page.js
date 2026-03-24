// Open Data Analysis Page JavaScript
// Fetches and renders parquet files directly from GitHub repos

// Global variable for plot data (loaded from JSON)
let plotsData = [];

// Download functions for open data sharing
function downloadJSON(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function downloadPlotData(plotItem) {
    const filename = `${plotItem.repo_name}_${plotItem.file_path.replace(/\//g, '_')}`;
    downloadJSON(plotItem, filename);
}

// Wait for hyparquet to be available (loaded as ES module in analysis.html)
async function waitForHyparquet() {
    if (window.hyparquetReadObjects) return;
    console.log('[Analysis] Waiting for hyparquet to load...');
    await new Promise((resolve, reject) => {
        const start = Date.now();
        const check = setInterval(() => {
            if (window.hyparquetReadObjects) { clearInterval(check); resolve(); }
            else if (Date.now() - start > 15000) { clearInterval(check); reject(new Error('hyparquet library failed to load after 15s. Check internet connection.')); }
        }, 100);
    });
}

// Parse an ArrayBuffer containing a parquet file into row objects using hyparquet
async function parseParquetBuffer(arrayBuffer) {
    await waitForHyparquet();
    // parquetReadObjects accepts ArrayBuffer directly and returns row objects
    const rows = await window.hyparquetReadObjects({ file: arrayBuffer });
    return rows;
}

// Fetch and parse parquet file from GitHub repo using hyparquet
async function fetchParquetData(repoNameOrUrl, filePathOrSize = null) {
    console.log('[Analysis] fetchParquetData called:', { repoNameOrUrl, filePathOrSize });
    
    try {
        await waitForHyparquet();
        
        const url = typeof filePathOrSize === 'string'
            ? `https://raw.githubusercontent.com/CGutt-hub/${repoNameOrUrl}/main/${filePathOrSize}`
            : repoNameOrUrl;
        
        const fileSize = typeof filePathOrSize === 'number' ? filePathOrSize : 0;
        
        console.log('[Analysis] Fetching:', url);
        
        // Fetch full file (raw.githubusercontent.com doesn't support HTTP range requests)
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${url}`);
        const arrayBuffer = await response.arrayBuffer();
        
        // Detect Git LFS pointer stubs (small text files starting with "version https://git-lfs")
        if (arrayBuffer.byteLength < 200) {
            const preview = new TextDecoder().decode(arrayBuffer.slice(0, 40));
            if (preview.startsWith('version https://git-lfs')) {
                throw new Error('LFS_POINTER: This file is a Git LFS pointer, not actual data. The source repository needs to be redeployed with LFS disabled for the public copy.');
            }
        }
        
        console.log('[Analysis] Parsing parquet file with hyparquet...');
        const parseStart = Date.now();
        const rows = await window.hyparquetReadObjects({ file: arrayBuffer });
        const parseTime = ((Date.now() - parseStart) / 1000).toFixed(1);
        console.log(`[Analysis] Parsed ${rows.length} rows in ${parseTime}s`);
        
        const sizeMB = (arrayBuffer.byteLength / 1024 / 1024).toFixed(2);
        console.log(`[Analysis] File size: ${sizeMB} MB`);
        
        return { rows, arrayBuffer };
    } catch (error) {
        if (error.name === 'AbortError') {
            throw new Error('Download timeout - file is too large or connection too slow.');
        }
        console.error('Error fetching/parsing parquet:', error);
        throw error;
    }
}

// Convert parquet data to Plotly format
// Handles AnalysisToolbox plot specification parquet files:
//   plot_type: 'bar' | 'grid'
//   x_data[0]: array of x-axis categories
//   y_data[0]: array of arrays (one per condition/series)
//   labels[0] or condition column: series names
//   y_var[0]: error bars (std dev)
//   ci_lower/ci_upper: confidence intervals
//   x_label/y_label: axis titles
async function parquetToPlotly(rowsOrBuffer, title = null) {
    let rows;

    // Handle arrayBuffer input (parse it first)
    if (rowsOrBuffer instanceof ArrayBuffer || ArrayBuffer.isView(rowsOrBuffer)) {
        const buf = rowsOrBuffer instanceof ArrayBuffer ? rowsOrBuffer : rowsOrBuffer.buffer;
        rows = await parseParquetBuffer(buf);
    } else {
        rows = rowsOrBuffer;
    }

    if (!rows || rows.length === 0) return null;

    const columns = Object.keys(rows[0]);

    // Vibrant color palette for the dark theme
    const COLORS = [
        '#c9a227', // gold (accent)
        '#4fc3f7', // sky blue
        '#ef5350', // coral red
        '#66bb6a', // green
        '#ab47bc', // purple
        '#ff7043', // orange
        '#26c6da', // teal
        '#ec407a', // pink
        '#8d6e63', // brown
        '#42a5f5', // blue
    ];

    // Detect AnalysisToolbox plot spec format (has x_data, y_data, plot_type)
    const isPlotSpec = columns.includes('x_data') && columns.includes('y_data') && columns.includes('plot_type');

    if (isPlotSpec) {
        return plotSpecToPlotly(rows, title, COLORS);
    }

    // Multi-row condition format (e.g. eeg_psd with 'condition' column, one row per condition)
    if (columns.includes('condition') && columns.includes('x_data') && columns.includes('y_data')) {
        return conditionRowsToPlotly(rows, title, COLORS);
    }

    // Fallback: generic columnar data — plot all numeric columns
    return genericToPlotly(rows, title, COLORS);
}

// AnalysisToolbox plot spec: single row contains full plot definition
function plotSpecToPlotly(rows, title, COLORS) {
    // May have multiple rows (e.g., per-condition) or a single row with nested arrays
    const row0 = rows[0];
    const plotType = row0.plot_type || 'bar';
    const xData = Array.isArray(row0.x_data) ? row0.x_data : [row0.x_data];
    const yDataNested = Array.isArray(row0.y_data) ? row0.y_data : [[row0.y_data]];
    const yVarNested = row0.y_var ? (Array.isArray(row0.y_var) ? row0.y_var : [[row0.y_var]]) : null;
    const ciLower = row0.ci_lower ? (Array.isArray(row0.ci_lower) ? row0.ci_lower : null) : null;
    const ciUpper = row0.ci_upper ? (Array.isArray(row0.ci_upper) ? row0.ci_upper : null) : null;

    // Get series labels
    let seriesLabels = null;
    if (row0.labels && Array.isArray(row0.labels)) {
        seriesLabels = row0.labels;
    }
    // For multi-row data, use condition column or row index
    if (!seriesLabels && rows.length > 1 && rows[0].condition) {
        seriesLabels = rows.map(r => r.condition);
    }

    const xLabels = xData;
    const xAxisTitle = row0.x_label || '';
    const yAxisTitle = row0.y_label || '';

    // Determine if y_data is nested (array of series arrays) or flat
    let seriesData;
    if (yDataNested.length > 0 && Array.isArray(yDataNested[0]) && Array.isArray(yDataNested[0][0])) {
        // Double nested: y_data = [[series1_vals], [series2_vals], [series3_vals]]
        seriesData = yDataNested[0];
    } else if (yDataNested.length > 0 && Array.isArray(yDataNested[0])) {
        // Single series
        seriesData = [yDataNested[0]];
    } else {
        seriesData = [yDataNested];
    }

    let varData = null;
    if (yVarNested) {
        if (yVarNested.length > 0 && Array.isArray(yVarNested[0]) && Array.isArray(yVarNested[0][0])) {
            varData = yVarNested[0];
        } else if (yVarNested.length > 0 && Array.isArray(yVarNested[0])) {
            varData = [yVarNested[0]];
        }
    }

    const traces = [];
    for (let s = 0; s < seriesData.length; s++) {
        const yVals = seriesData[s];
        const label = seriesLabels ? (seriesLabels[s] || `Series ${s + 1}`) : `Series ${s + 1}`;
        const color = COLORS[s % COLORS.length];

        const trace = {
            x: xLabels,
            y: yVals,
            name: label,
            type: 'bar',
            marker: {
                color: color,
                line: { color: color, width: 1 },
                opacity: 0.85,
            },
        };

        // Add error bars from y_var or ci bounds
        if (varData && varData[s]) {
            const errVals = varData[s];
            const hasError = errVals.some(v => v > 0);
            if (hasError) {
                trace.error_y = {
                    type: 'data',
                    array: errVals,
                    visible: true,
                    color: '#aaa',
                    thickness: 1.5,
                    width: 4,
                };
            }
        } else if (ciLower && ciUpper && ciLower[s] && ciUpper[s]) {
            const errPlus = yVals.map((v, i) => (ciUpper[s][i] || 0) - v);
            const errMinus = yVals.map((v, i) => v - (ciLower[s][i] || 0));
            trace.error_y = {
                type: 'data',
                array: errPlus,
                arrayminus: errMinus,
                visible: true,
                color: '#aaa',
                thickness: 1.5,
                width: 4,
            };
        }

        traces.push(trace);
    }

    const cs = typeof getComputedStyle !== 'undefined' ? getComputedStyle(document.documentElement) : null;
    const bgColor = cs ? (cs.getPropertyValue('--bg-secondary').trim() || '#161616') : '#161616';
    const textColor = cs ? (cs.getPropertyValue('--text-primary').trim() || '#e8e8e8') : '#e8e8e8';
    const gridColor = cs ? (cs.getPropertyValue('--border-primary').trim() || '#2a2a2a') : '#2a2a2a';

    const layout = {
        title: { text: title || yAxisTitle || 'Analysis Result', font: { color: textColor, size: 16 } },
        xaxis: {
            title: { text: xAxisTitle, font: { color: textColor } },
            tickfont: { color: textColor, size: 11 },
            gridcolor: gridColor,
            linecolor: gridColor,
        },
        yaxis: {
            title: { text: yAxisTitle, font: { color: textColor } },
            tickfont: { color: textColor, size: 11 },
            tickangle: -45,
            gridcolor: gridColor,
            linecolor: gridColor,
        },
        barmode: 'group',
        bargap: 0.2,
        bargroupgap: 0.1,
        paper_bgcolor: bgColor,
        plot_bgcolor: bgColor,
        font: { color: textColor, family: "'JetBrains Mono', monospace" },
        legend: {
            font: { color: textColor, size: 11 },
            bgcolor: 'rgba(0,0,0,0)',
        },
        hovermode: 'closest',
        margin: { t: 60, b: computeBottomMargin(xLabels), l: 70, r: 30 },
    };

    return { data: traces, layout };
}

// Compute bottom margin based on the longest x-axis tick label
function computeBottomMargin(xLabels) {
    if (!xLabels || xLabels.length === 0) return 80;
    const maxLen = Math.max(...xLabels.map(l => String(l).length));
    if (maxLen <= 8) return 80;
    if (maxLen <= 15) return 120;
    if (maxLen <= 25) return 160;
    return 200;
}

// Multi-row condition format: one row per condition, each with x_data and y_data
function conditionRowsToPlotly(rows, title, COLORS) {
    const xAxisTitle = rows[0].x_label || '';
    const yAxisTitle = rows[0].y_label || '';

    const traces = rows.map((row, i) => {
        const xData = Array.isArray(row.x_data) ? row.x_data : [row.x_data];
        const yData = Array.isArray(row.y_data) ? row.y_data : [row.y_data];
        const label = row.condition || `Series ${i + 1}`;
        const color = COLORS[i % COLORS.length];

        const trace = {
            x: xData,
            y: yData,
            name: label,
            type: 'bar',
            marker: { color: color, opacity: 0.85 },
        };

        if (row.y_var) {
            const errVals = Array.isArray(row.y_var) ? row.y_var : [row.y_var];
            const hasError = errVals.some(v => v > 0);
            if (hasError) {
                trace.error_y = { type: 'data', array: errVals, visible: true, color: '#aaa', thickness: 1.5, width: 4 };
            }
        }
        if (row.ci_lower && row.ci_upper) {
            const cl = Array.isArray(row.ci_lower) ? row.ci_lower : [row.ci_lower];
            const cu = Array.isArray(row.ci_upper) ? row.ci_upper : [row.ci_upper];
            trace.error_y = {
                type: 'data',
                array: yData.map((v, j) => (cu[j] || 0) - v),
                arrayminus: yData.map((v, j) => v - (cl[j] || 0)),
                visible: true, color: '#aaa', thickness: 1.5, width: 4,
            };
        }
        return trace;
    });

    const cs = typeof getComputedStyle !== 'undefined' ? getComputedStyle(document.documentElement) : null;
    const bgColor = cs ? (cs.getPropertyValue('--bg-secondary').trim() || '#161616') : '#161616';
    const textColor = cs ? (cs.getPropertyValue('--text-primary').trim() || '#e8e8e8') : '#e8e8e8';
    const gridColor = cs ? (cs.getPropertyValue('--border-primary').trim() || '#2a2a2a') : '#2a2a2a';

    return {
        data: traces,
        layout: {
            title: { text: title || yAxisTitle || 'Analysis Result', font: { color: textColor, size: 16 } },
            xaxis: { title: { text: xAxisTitle, font: { color: textColor } }, tickfont: { color: textColor }, tickangle: -45, gridcolor: gridColor, linecolor: gridColor },
            yaxis: { title: { text: yAxisTitle, font: { color: textColor } }, tickfont: { color: textColor }, gridcolor: gridColor, linecolor: gridColor },
            barmode: 'group', bargap: 0.2, bargroupgap: 0.1,
            paper_bgcolor: bgColor, plot_bgcolor: bgColor,
            font: { color: textColor, family: "'JetBrains Mono', monospace" },
            legend: { font: { color: textColor, size: 11 }, bgcolor: 'rgba(0,0,0,0)' },
            hovermode: 'closest', margin: { t: 60, b: computeBottomMargin(rows.map(r => Array.isArray(r.x_data) ? r.x_data : [r.x_data]).flat()), l: 70, r: 30 },
        },
    };
}

// Fallback: generic columnar data — plot all numeric columns vs first column
function genericToPlotly(rows, title, COLORS) {
    const columns = Object.keys(rows[0]);
    const xCol = columns[0];
    const numericCols = columns.slice(1).filter(c => {
        const v = rows[0][c];
        return typeof v === 'number' || (typeof v === 'string' && !isNaN(parseFloat(v)));
    });

    if (numericCols.length === 0) return null;

    const traces = numericCols.map((col, i) => ({
        x: rows.map(r => r[xCol]),
        y: rows.map(r => typeof r[col] === 'number' ? r[col] : parseFloat(r[col])),
        name: col,
        type: 'scatter',
        mode: 'lines+markers',
        line: { color: COLORS[i % COLORS.length], width: 2 },
        marker: { color: COLORS[i % COLORS.length], size: 5 },
    }));

    const cs = typeof getComputedStyle !== 'undefined' ? getComputedStyle(document.documentElement) : null;
    const bgColor = cs ? (cs.getPropertyValue('--bg-secondary').trim() || '#161616') : '#161616';
    const textColor = cs ? (cs.getPropertyValue('--text-primary').trim() || '#e8e8e8') : '#e8e8e8';
    const gridColor = cs ? (cs.getPropertyValue('--border-primary').trim() || '#2a2a2a') : '#2a2a2a';

    return {
        data: traces,
        layout: {
            title: { text: title || `${numericCols.join(', ')} vs ${xCol}`, font: { color: textColor, size: 16 } },
            xaxis: { title: { text: xCol, font: { color: textColor } }, tickfont: { color: textColor }, tickangle: -45, gridcolor: gridColor, linecolor: gridColor },
            yaxis: { tickfont: { color: textColor }, gridcolor: gridColor, linecolor: gridColor },
            paper_bgcolor: bgColor, plot_bgcolor: bgColor,
            font: { color: textColor, family: "'JetBrains Mono', monospace" },
            legend: { font: { color: textColor, size: 11 }, bgcolor: 'rgba(0,0,0,0)' },
            hovermode: 'closest', margin: { t: 60, b: computeBottomMargin(rows.map(r => r[xCol])), l: 70, r: 30 },
        },
    };
}

async function findParquetFile(plotItem) {
    // Try to find associated parquet file by checking common patterns
    const basePath = plotItem.file_path.replace(/\.json$/, '').replace(/[_-]?(plot|figure|viz|visual|chart|graph)s?/i, '');
    const dirPath = plotItem.file_path.substring(0, plotItem.file_path.lastIndexOf('/'));
    
    const possiblePaths = [
        basePath + '.parquet',
        basePath + '_data.parquet',
        dirPath + '/data.parquet',
        dirPath + '/processed_data.parquet',
        'data.parquet',
        'processed_data.parquet'
    ];
    
    // Try to fetch each possible parquet file
    for (const path of possiblePaths) {
        try {
            const url = `https://raw.githubusercontent.com/CGutt-hub/${plotItem.repo_name}/main/${path}`;
            const response = await fetch(url);
            if (response.ok) {
                const arrayBuffer = await response.arrayBuffer();
                return { data: arrayBuffer, filename: path.split('/').pop() };
            }
        } catch (e) {
            continue;
        }
    }
    return null;
}

async function downloadPlotPDFA(plotItem, plotIndex) {
    try {
        // Wait for pdf-lib to load
        if (typeof PDFLib === 'undefined') {
            await new Promise(resolve => {
                const checkInterval = setInterval(() => {
                    if (typeof PDFLib !== 'undefined') {
                        clearInterval(checkInterval);
                        resolve();
                    }
                }, 100);
            });
        }
        
        const { PDFDocument, StandardFonts, rgb } = PDFLib;
        
        // Convert plot to grayscale image
        const plotContainer = document.getElementById(`plot-container-${plotIndex}`);
        const plotImageDataUrl = await Plotly.toImage(plotContainer, {
            format: 'png',
            width: 1200,
            height: 800
        });
        
        // Convert to grayscale
        const img = new Image();
        img.src = plotImageDataUrl;
        await new Promise(resolve => img.onload = resolve);
        
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        
        // Convert to grayscale
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
            const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            data[i] = gray;
            data[i + 1] = gray;
            data[i + 2] = gray;
        }
        ctx.putImageData(imageData, 0, 0);
        const grayscaleImageUrl = canvas.toDataURL('image/png');
        
        // Create PDF document
        const pdfDoc = await PDFDocument.create();
        const page = pdfDoc.addPage([842, 595]); // A4 landscape in points
        const { width, height } = page.getSize();
        
        // Embed font
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
        
        // Add title
        page.drawText(plotItem.file_path, {
            x: 50,
            y: height - 50,
            size: 16,
            font: fontBold,
            color: rgb(0, 0, 0)
        });
        
        // Add repository info
        page.drawText(`Repository: ${plotItem.repo_name}`, {
            x: 50,
            y: height - 75,
            size: 10,
            font: font,
            color: rgb(0.3, 0.3, 0.3)
        });
        
        page.drawText(`Updated: ${new Date(plotItem.updated).toLocaleString()}`, {
            x: 50,
            y: height - 90,
            size: 10,
            font: font,
            color: rgb(0.3, 0.3, 0.3)
        });
        
        // Embed grayscale plot image
        const imageBytes = await fetch(grayscaleImageUrl).then(res => res.arrayBuffer());
        const pngImage = await pdfDoc.embedPng(imageBytes);
        const imgDims = pngImage.scale(0.6);
        
        page.drawImage(pngImage, {
            x: 50,
            y: 100,
            width: imgDims.width,
            height: imgDims.height
        });
        
        // Try to fetch and embed parquet file as attachment
        const parquetFile = await findParquetFile(plotItem);
        if (parquetFile) {
            // Attach parquet file to PDF
            await pdfDoc.attach(parquetFile.data, parquetFile.filename, {
                mimeType: 'application/octet-stream',
                description: 'Source data in Apache Parquet format',
                creationDate: new Date(plotItem.updated),
                modificationDate: new Date(plotItem.updated)
            });
            
            // Add note about attachment
            page.drawText('Source data attached as: ' + parquetFile.filename, {
                x: 50,
                y: 70,
                size: 9,
                font: font,
                color: rgb(0, 0.5, 0)
            });
        } else {
            // Add note about no attachment
            page.drawText('No source parquet file found', {
                x: 50,
                y: 70,
                size: 9,
                font: font,
                color: rgb(0.7, 0.3, 0)
            });
        }
        
        // Set PDF metadata
        pdfDoc.setTitle(plotItem.file_path);
        pdfDoc.setAuthor('Çağatay Özcan Jagiello Gutt');
        pdfDoc.setSubject(`Research data from ${plotItem.repo_name}`);
        pdfDoc.setKeywords(['research', 'open data', 'analysis']);
        pdfDoc.setCreator('Open Data - 5ha99y');
        pdfDoc.setProducer('pdf-lib (https://pdf-lib.js.org)');
        
        // Save PDF
        const pdfBytes = await pdfDoc.save();
        const pdfBlob = new Blob([pdfBytes], { type: 'application/pdf' });
        const pdfFilename = `${plotItem.repo_name.replace(/\//g, '_')}_${plotItem.file_path.replace(/\//g, '_').replace('.json', '')}.pdf`;
        
        const a = document.createElement('a');
        a.href = URL.createObjectURL(pdfBlob);
        a.download = pdfFilename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
        
        if (parquetFile) {
            alert('Downloaded PDF/A with embedded parquet data attachment');
        } else {
            alert('Downloaded PDF (no source parquet file found)');
        }
        
    } catch (error) {
        console.error('Error generating PDF:', error);
        alert(`Error generating PDF: ${error.message}`);
    }
}

function downloadAllData() {
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `research-analysis-export_${timestamp}.json`;
    const exportData = {
        export_date: new Date().toISOString(),
        total_plots: plotsData.length,
        data: plotsData
    };
    downloadJSON(exportData, filename);
}

// Build file tree from plot data
function buildFileTree() {
    const fileTree = document.getElementById('file-tree');
    
    // Group by repository
    const repoMap = {};
    plotsData.forEach((plot, index) => {
        if (!repoMap[plot.repo_name]) {
            repoMap[plot.repo_name] = [];
        }
        repoMap[plot.repo_name].push({ ...plot, index });
    });
    
    // Create tree structure
    Object.keys(repoMap).sort().forEach(repoName => {
        const repoSection = document.createElement('div');
        repoSection.className = 'repo-section';
        
        const repoHeader = document.createElement('div');
        repoHeader.className = 'repo-name';
        repoHeader.innerHTML = `<span class="repo-toggle">▶</span> ${repoName}`;
        
        const fileList = document.createElement('div');
        fileList.className = 'file-list';
        
        repoMap[repoName].forEach(plot => {
            const fileItem = document.createElement('div');
            fileItem.className = 'file-item';
            fileItem.dataset.index = plot.index;
            fileItem.dataset.repoName = plot.repo_name;
            fileItem.dataset.filePath = plot.file_path;
            
            // Create file name span
            const fileName = document.createElement('span');
            fileName.textContent = plot.file_path;
            fileName.style.flex = '1';
            fileName.style.cursor = 'pointer';
            fileName.onclick = () => {
                showPlot(plot.index);
            };
            
            // Create download buttons container
            const downloadBtns = document.createElement('div');
            downloadBtns.style.display = 'flex';
            downloadBtns.style.gap = '4px';
            downloadBtns.style.marginLeft = '8px';
            
            // JSON download button
            const jsonBtn = document.createElement('button');
            jsonBtn.innerHTML = 'JSON';
            jsonBtn.title = 'Download JSON';
            jsonBtn.className = 'sidebar-download-btn';
            jsonBtn.style.padding = '2px 6px';
            jsonBtn.style.fontSize = '0.75em';
            jsonBtn.style.border = '1px solid var(--border-primary)';
            jsonBtn.style.borderRadius = '3px';
            jsonBtn.style.background = 'var(--bg-tertiary)';
            jsonBtn.style.cursor = 'pointer';
            jsonBtn.onclick = (e) => {
                e.stopPropagation();
                downloadPlotData(plotsData[plot.index]);
            };
            
            // PDF/A download button
            const pdfBtn = document.createElement('button');
            pdfBtn.innerHTML = 'PDF';
            pdfBtn.title = 'Download PDF/A + Parquet';
            pdfBtn.className = 'sidebar-download-btn';
            pdfBtn.style.padding = '2px 6px';
            pdfBtn.style.fontSize = '0.75em';
            pdfBtn.style.border = '1px solid var(--border-primary)';
            pdfBtn.style.borderRadius = '3px';
            pdfBtn.style.background = 'var(--bg-tertiary)';
            pdfBtn.style.cursor = 'pointer';
            pdfBtn.onclick = (e) => {
                e.stopPropagation();
                downloadPlotPDFA(plotsData[plot.index], plot.index);
            };
            
            downloadBtns.appendChild(jsonBtn);
            downloadBtns.appendChild(pdfBtn);
            
            fileItem.appendChild(fileName);
            fileItem.appendChild(downloadBtns);
            fileItem.style.display = 'flex';
            fileItem.style.alignItems = 'center';
            
            fileList.appendChild(fileItem);
        });
        
        // Toggle expansion
        repoHeader.onclick = () => {
            const isExpanded = fileList.classList.toggle('expanded');
            const toggleIcon = repoHeader.querySelector('.repo-toggle');
            toggleIcon.textContent = isExpanded ? '▼' : '▶';
            toggleIcon.classList.toggle('expanded', isExpanded);
        };
        
        repoSection.appendChild(repoHeader);
        repoSection.appendChild(fileList);
        fileTree.appendChild(repoSection);
    });
    
    // Expand first repo and show first plot by default
    if (fileTree.firstChild) {
        const firstRepo = fileTree.firstChild.querySelector('.repo-name');
        firstRepo.click();
        const firstFile = fileTree.firstChild.querySelector('.file-item span');
        if (firstFile) {
            firstFile.click();
        }
    }
}

// Show a specific plot
function showPlot(index) {
    // Update active state in sidebar
    document.querySelectorAll('.file-item').forEach(item => {
        item.classList.remove('active');
    });
    const activeItem = document.querySelector(`[data-index="${index}"]`);
    if (activeItem) {
        activeItem.classList.add('active');
    }
    
    // Hide empty state and all plots
    document.getElementById('empty-state').style.display = 'none';
    document.querySelectorAll('.plot-display').forEach(plot => {
        plot.classList.remove('active');
    });
    
    // Show selected plot
    const plotDisplay = document.getElementById(`plot-${index}`);
    if (plotDisplay) {
        plotDisplay.classList.add('active');
    }
}

// Search functionality
document.getElementById('search-box')?.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    const fileItems = document.querySelectorAll('.file-item');
    
    fileItems.forEach(item => {
        const repoName = item.dataset.repoName.toLowerCase();
        const filePath = item.dataset.filePath.toLowerCase();
        const matches = repoName.includes(query) || filePath.includes(query);
        
        if (matches || query === '') {
            item.classList.remove('hidden-by-search');
        } else {
            item.classList.add('hidden-by-search');
        }
    });
});

// Render all analysis results
function renderPlots() {
    console.log('[Analysis] renderPlots() called');
    console.log('[Analysis] plotsData length:', plotsData ? plotsData.length : 'undefined');
    
    const plotDisplays = document.getElementById('plot-displays');
    const emptyState = document.getElementById('empty-state');
    const downloadSection = document.getElementById('download-all-section');
    const sidebar = document.querySelector('.analysis-sidebar');
    
    if (plotsData.length === 0) {
        emptyState.innerHTML = `
            <h2>No deployed experiments yet</h2>
            <p><em>Results will appear here once experiments are ready for public deployment.</em></p>
            <hr style="margin: 30px 0; border: none; border-top: 1px solid var(--border-primary);">
            <h3>About This Page</h3>
            <p style="max-width: 600px; margin: 15px auto;">
                This page displays real-time analysis results from deployed research experiments. 
                Experiments appear here after analysis pipelines have been validated, pilots completed, and proposals approved.
            </p>
            <h3 style="margin-top: 30px;">Deployment Workflow</h3>
            <ol style="text-align: left; max-width: 600px; margin: 15px auto; line-height: 1.8;">
                <li><strong>Analysis Structure</strong> — Pipeline is developed and matured in backoffice</li>
                <li><strong>Pilot Testing</strong> — Protocol is validated with pilot participants</li>
                <li><strong>Proposal Approval</strong> — Research proposal is submitted and approved</li>
                <li><strong>Public Deployment</strong> — Experiment moves to public-facing repository</li>
                <li><strong>Real-Time Updates</strong> — Analysis results sync automatically as data is collected</li>
            </ol>
            <p style="max-width: 600px; margin: 20px auto;">
                <strong>Analysis Toolbox</strong> generates JSON representations at each processing step, 
                enabling transparent observation of data collection and analysis as it happens.
            </p>
        `;
        return;
    }
    
    // Check if first item is parquet type (scientific data repos)
    const firstPlot = plotsData[0];
    console.log('[Analysis] First plot:', firstPlot);
    console.log('[Analysis] First plot type:', firstPlot?.plot_data?.type);
    
    if (firstPlot && firstPlot.plot_data && firstPlot.plot_data.type === 'parquet') {
        console.log('[Analysis] Detected parquet type, building file tree...');
        
        // Hide empty state
        emptyState.style.display = 'none';
        
        // Build EmotiView-style file tree from parquet data
        const repoPath = firstPlot.repo_name.includes('/') ? firstPlot.repo_name : 'CGutt-hub/' + firstPlot.repo_name;
        
        // Extract results_dir from file_path (e.g., "EV_results" from "EV_results/EV_002/plots/file.parquet")
        const resultsDir = firstPlot.file_path.split('/')[0];
        
        // Process plotsData into the format we need
        const parquetFiles = plotsData.map(item => {
            const pathParts = item.file_path.split('/');
            let level = null;
            let participant;
            if (pathParts.length >= 4 && /^l[12]$/.test(pathParts[1])) {
                level = pathParts[1];
                participant = pathParts[2];
            } else {
                participant = pathParts[1];
            }
            const filename = pathParts[pathParts.length - 1];
            
            return {
                path: item.file_path,
                url: `https://raw.githubusercontent.com/${repoPath}/main/${item.file_path}`,
                participant: participant,
                filename: filename,
                level: level,
                size: item.plot_data.size || 0
            };
        });
        
        console.log('[Analysis] Processing parquet files:', parquetFiles.length);
        
        // Group by participant
        const byParticipant = {};
        parquetFiles.forEach(file => {
            if (!byParticipant[file.participant]) {
                byParticipant[file.participant] = [];
            }
            byParticipant[file.participant].push(file);
        });
        
        console.log('[Analysis] Grouped by participant:', Object.keys(byParticipant));
        
        // Store data globally for search and display
        window.analysisData = {
            repoName: firstPlot.repo_name,
            repoPath: repoPath,
            resultsDir: resultsDir,
            byParticipant: byParticipant,
            allFiles: parquetFiles
        };
        
        // Build hierarchical file tree (EmotiView style)
        buildAnalysisFileTree();
        console.log('[Analysis] File tree built');
        
        // Fetch pipeline structure (rendered only when a plot file is accessed)
        fetchPipelineTrace(repoPath, resultsDir);
        
        // Initialize search
        const searchInput = document.getElementById('search-box');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                filterFileTree(e.target.value);
            });
        }
        
        return; // Exit early for parquet types
    }
    
    // For other plot types (original sidebar-based interface)
    // Hide empty state and show download section
    emptyState.style.display = 'none';
    downloadSection.classList.add('visible');
    document.getElementById('download-all-btn').onclick = downloadAllData;
    
    // Build file tree
    buildFileTree();
    
    // Create a display for each plot
    plotsData.forEach((plotItem, index) => {
        // Skip parquet types - they're handled at the top level with tree view
        if (plotItem.plot_data && plotItem.plot_data.type === 'parquet') {
            return;
        }
        
        const plotDisplay = document.createElement('div');
        plotDisplay.className = 'plot-display';
        plotDisplay.id = `plot-${index}`;
        
        // Header with metadata
        const header = document.createElement('div');
        header.className = 'plot-header';
        header.innerHTML = `
            <h2>${plotItem.file_path}</h2>
            <div class="plot-meta">
                <p><strong>Repository:</strong> <a href="${plotItem.repo_url}" target="_blank">${plotItem.repo_name}</a></p>
                <p><strong>Last Updated:</strong> ${new Date(plotItem.updated).toLocaleString()}</p>
            </div>
        `;
        plotDisplay.appendChild(header);
        
        // Add README section if available
        if (plotItem.readme) {
            const readmeSection = document.createElement('details');
            readmeSection.className = 'readme-section';
            readmeSection.style.margin = '15px 0';
            readmeSection.style.padding = '15px';
            readmeSection.style.background = 'var(--bg-secondary, #f8f9fa)';
            readmeSection.style.borderRadius = '4px';
            readmeSection.style.border = '1px solid var(--border-primary, #ddd)';
            
            const summary = document.createElement('summary');
            summary.style.cursor = 'pointer';
            summary.style.fontWeight = 'bold';
            summary.style.marginBottom = '10px';
            summary.textContent = 'Context & Documentation';
            
            const readmeContent = document.createElement('div');
            readmeContent.className = 'readme-content';
            readmeContent.style.marginTop = '10px';
            readmeContent.style.lineHeight = '1.6';
            readmeContent.className = 'readme-content rendered-markdown';
            readmeContent.innerHTML = typeof marked !== 'undefined' ? marked.parse(plotItem.readme) : plotItem.readme;
            
            readmeSection.appendChild(summary);
            readmeSection.appendChild(readmeContent);
            plotDisplay.appendChild(readmeSection);
        }
        
        // Add Pipeline Tree section if available
        if (plotItem.pipeline_trace && plotItem.pipeline_trace.processes) {
            const pipelineSection = document.createElement('details');
            pipelineSection.className = 'pipeline-section';
            pipelineSection.style.margin = '15px 0';
            pipelineSection.style.padding = '15px';
            pipelineSection.style.background = 'var(--bg-secondary, #f0f4f8)';
            pipelineSection.style.borderRadius = '4px';
            pipelineSection.style.border = '1px solid var(--border-primary, #ddd)';
            pipelineSection.setAttribute('open', '');
            
            const pipelineSummary = document.createElement('summary');
            pipelineSummary.style.cursor = 'pointer';
            pipelineSummary.style.fontWeight = 'bold';
            pipelineSummary.style.marginBottom = '15px';
            pipelineSummary.textContent = `Analysis Pipeline (${plotItem.pipeline_trace.total_processes} processes, ${plotItem.pipeline_trace.total_tasks} tasks completed)`;
            
            const pipelineContent = document.createElement('div');
            pipelineContent.className = 'pipeline-content';
            pipelineContent.style.marginTop = '15px';
            
            // Add explanatory note
            const note = document.createElement('div');
            note.style.fontSize = '0.85em';
            note.style.color = 'var(--text-secondary)';
            note.style.marginBottom = '15px';
            note.style.padding = '8px 12px';
            note.style.background = 'var(--bg-tertiary, #e9ecef)';
            note.style.borderRadius = '4px';
            note.innerHTML = 'This shows the complete analysis workflow from a participant run. Each process represents a step in the data processing pipeline.';
            pipelineContent.appendChild(note);
            
            // Create visual pipeline tree
            const pipelineTree = document.createElement('div');
            pipelineTree.style.display = 'flex';
            pipelineTree.style.flexDirection = 'column';
            pipelineTree.style.gap = '10px';
            pipelineTree.style.fontFamily = 'var(--font-mono, monospace)';
            pipelineTree.style.fontSize = '0.9em';
            
            plotItem.pipeline_trace.processes.forEach((process, idx) => {
                const processNode = document.createElement('div');
                processNode.style.display = 'flex';
                processNode.style.alignItems = 'center';
                processNode.style.gap = '10px';
                processNode.style.padding = '10px';
                processNode.style.borderRadius = '6px';
                processNode.style.background = 'var(--bg-primary, white)';
                processNode.style.border = '2px solid';
                
                // Color based on status (only final states visible in public repo)
                let borderColor = '#28a745';  // Default: completed
                let statusIcon = '';
                if (process.status === 'FAILED') {
                    borderColor = '#dc3545';
                    statusIcon = 'FAIL';
                } else if (process.status === 'CACHED') {
                    borderColor = '#17a2b8';
                    statusIcon = 'CACHED';
                } else if (process.status === 'COMPLETED') {
                    borderColor = '#28a745';
                    statusIcon = 'OK';
                }
                processNode.style.borderColor = borderColor;
                
                // Add connection line to previous process
                if (idx > 0) {
                    const connector = document.createElement('div');
                    connector.style.width = '2px';
                    connector.style.height = '10px';
                    connector.style.background = '#6c757d';
                    connector.style.marginLeft = '30px';
                    pipelineTree.appendChild(connector);
                }
                
                // Process content
                processNode.innerHTML = `
                    <span style="font-size: 1.2em;">${statusIcon}</span>
                    <div style="flex: 1;">
                        <div style="font-weight: bold; color: var(--text-primary);">${process.name}</div>
                        <div style="font-size: 0.85em; color: var(--text-secondary);">
                            Status: ${process.status} | Tasks: ${process.total_tasks}
                        </div>
                    </div>
                `;
                
                pipelineTree.appendChild(processNode);
            });
            
            pipelineContent.appendChild(pipelineTree);
            pipelineSection.appendChild(pipelineSummary);
            pipelineSection.appendChild(pipelineContent);
            plotDisplay.appendChild(pipelineSection);
        }
        
        // Plot container
        const plotContainer = document.createElement('div');
        plotContainer.className = 'plot-container';
        plotContainer.id = `plot-container-${index}`;
        plotDisplay.appendChild(plotContainer);
        
        plotDisplays.appendChild(plotDisplay);
        
        // Render plot with Plotly
        try {
            const plotData = plotItem.plot_data;
            
            // Handle AnalysisToolbox HTML viewers - fetch parquet files directly
            if (plotData.type === 'html_viewer') {
                const repoPath = plotItem.repo_name.includes('/') ? plotItem.repo_name : 'CGutt-hub/' + plotItem.repo_name;
                const resultsDir = plotData.results_dir;
                
                plotContainer.innerHTML = `
                    <div style="padding: 20px; text-align: center;">
                        <p style="margin-bottom: 20px; color: var(--text-secondary);">
                            <span class="spinner" style="display: inline-block; width: 16px; height: 16px; border: 2px solid var(--text-muted); border-top: 2px solid var(--accent-primary); border-radius: 50%; animation: spin 0.8s linear infinite; margin-right: 8px; vertical-align: middle;"></span>
                            Discovering analysis data from repository...
                        </p>
                    </div>
                `;
                
                // Fetch repository tree to find all parquet files
                fetch(`https://api.github.com/repos/${repoPath}/git/trees/main?recursive=1`)
                    .then(response => response.json())
                    .then(data => {
                        // Filter for parquet files in results directory
                        const parquetFiles = data.tree
                            .filter(item => 
                                item.path.startsWith(resultsDir) && 
                                item.path.endsWith('.parquet') &&
                                item.path.includes('/plots/') &&
                                !item.path.includes('_log.parquet') && // Skip raw log files
                                !item.path.includes('_log_tddr') // Skip TDDR intermediate files
                            )
                            .map(item => {
                                const pathParts = item.path.split('/');
                                const participant = pathParts[1]; // EV_002, EV_003, etc.
                                const filename = pathParts[pathParts.length - 1];
                                const displayName = filename
                                   .replace('.parquet', '')
                                    .replace(participant + '_', '')
                                    .replace(/_/g, ' ')
                                    .split(' ')
                                    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                                    .join(' ');
                                
                                return {
                                    path: item.path,
                                    url: `https://raw.githubusercontent.com/${repoPath}/main/${item.path}`,
                                    participant: participant,
                                    displayName: displayName,
                                    size: item.size
                                };
                            });
                        
                        // Group by participant
                        const byParticipant = {};
                        parquetFiles.forEach(file => {
                            if (!byParticipant[file.participant]) {
                                byParticipant[file.participant] = [];
                            }
                            byParticipant[file.participant].push(file);
                        });
                        
                        // Render grouped files
                        const participantKeys = Object.keys(byParticipant).sort();
                        
                        plotContainer.innerHTML = `
                            <div style="padding: 20px;">
                                <div style="margin-bottom: 25px; text-align: center;">
                                    <h3 style="margin: 0 0 10px 0; color: var(--text-primary);">Analysis Data</h3>
                                    <p style="margin: 0; color: var(--text-secondary); font-size: 0.95em;">
                                        Found <strong>${parquetFiles.length} plots</strong> across <strong>${participantKeys.length} participants</strong>
                                    </p>
                                </div>
                                
                                <div id="participants-container-${index}" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 15px; margin-bottom: 25px;">
                                    ${participantKeys.map(participant => `
                                        <div style="background: var(--bg-secondary); border: 1px solid var(--border-primary); border-radius: 8px; padding: 15px; cursor: pointer; transition: all 0.2s;" 
                                             onmouseover="this.style.borderColor='var(--accent-primary)'; this.style.transform='translateY(-2px)';" 
                                             onmouseout="this.style.borderColor='var(--border-primary)'; this.style.transform='translateY(0)';"
                                             onclick="showParticipantPlots('${participant}', ${index})">
                                            <div style="font-weight: 600; font-size: 1.1em; margin-bottom: 8px; color: var(--text-primary);">
                                                ${participant}
                                            </div>
                                            <div style="color: var(--text-secondary); font-size: 0.9em;">
                                                ${byParticipant[participant].length} plots available
                                            </div>
                                        </div>
                                    `).join('')}
                                </div>
                                
                                <div id="plot-viewer-${index}" style="display: none;">
                                    <div style="margin-bottom: 15px; padding: 15px; background: var(--bg-secondary); border-radius: 8px;">
                                        <button onclick="document.getElementById('plot-viewer-${index}').style.display='none'; document.getElementById('participants-container-${index}').style.display='grid';" 
                                                style="padding: 8px 16px; background: var(--bg-tertiary); border: 1px solid var(--border-primary); border-radius: 6px; cursor: pointer; color: var(--text-primary); font-size: 0.9em;">
                                            ← Back to Participants
                                        </button>
                                        <span id="participant-name-${index}" style="margin-left: 15px; font-weight: 600; color: var(--text-primary);"></span>
                                    </div>
                                    
                                    <div id="plots-grid-${index}" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 12px; margin-bottom: 20px;">
                                    </div>
                                    
                                    <div id="plot-display-${index}" style="margin-top: 20px; padding: 20px; background: var(--bg-secondary); border-radius: 8px; display: none;">
                                        <div style="margin-bottom: 15px; display: flex; justify-content: space-between; align-items: center;">
                                            <h4 id="plot-title-${index}" style="margin: 0; color: var(--text-primary);"></h4>
                                            <button onclick="document.getElementById('plot-display-${index}').style.display='none';" 
                                                    style="padding: 6px 12px; background: var(--bg-tertiary); border: 1px solid var(--border-primary); border-radius: 4px; cursor: pointer; color: var(--text-primary); font-size: 0.85em;">
                                                Close
                                            </button>
                                        </div>
                                        <div id="plot-chart-${index}"></div>
                                    </div>
                                </div>
                            </div>
                        `;
                        
                        // Store data for later use
                        window[`parquetData_${index}`] = byParticipant;
                        
                        // Add helper functions if not already present
                        if (!window.showParticipantPlots) {
                            window.showParticipantPlots = function(participant, idx) {
                                const data = window[`parquetData_${idx}`][participant];
                                const plotsGrid = document.getElementById(`plots-grid-${idx}`);
                                const viewer = document.getElementById(`plot-viewer-${idx}`);
                                const container = document.getElementById(`participants-container-${idx}`);
                                const participantName = document.getElementById(`participant-name-${idx}`);
                                
                                container.style.display = 'none';
                                viewer.style.display = 'block';
                                participantName.textContent = participant;
                                
                                plotsGrid.innerHTML = data.map((file, fileIdx) => `
                                    <div style="background: var(--bg-tertiary); border: 1px solid var(--border-primary); border-radius: 6px; padding: 12px; cursor: pointer; transition: all 0.2s;"
                                         onmouseover="this.style.borderColor='var(--accent-primary)'" 
                                         onmouseout="this.style.borderColor='var(--border-primary)'"
                                         onclick="loadAndDisplayPlot('${file.url}', '${file.displayName}', ${idx}, '${participant}')">
                                        <div style="font-weight: 600; font-size: 0.95em; margin-bottom: 6px; color: var(--text-primary);">
                                            ${file.displayName}
                                        </div>
                                        <div style="color: var(--text-muted); font-size: 0.8em;">
                                            ${(file.size / 1024).toFixed(1)} KB
                                        </div>
                                    </div>
                                `).join('');
                            };
                            
                            window.loadAndDisplayPlot = async function(url, displayName, idx, participant) {
                                const plotDisplay = document.getElementById(`plot-display-${idx}`);
                                const plotTitle = document.getElementById(`plot-title-${idx}`);
                                const plotChart = document.getElementById(`plot-chart-${idx}`);
                                
                                plotDisplay.style.display = 'block';
                                plotTitle.textContent = `${participant} - ${displayName}`;
                                plotChart.innerHTML = `
                                    <div style="text-align: center; padding: 40px;">
                                        <div class="spinner" style="margin: 0 auto 15px auto; width: 40px; height: 40px; border: 4px solid var(--bg-tertiary); border-top: 4px solid var(--accent-primary); border-radius: 50%; animation: spin 1s linear infinite;"></div>
                                        <p style="color: var(--text-secondary);">Loading and parsing parquet file...</p>
                                    </div>
                                `;
                                
                                try {
                                    const { rows } = await fetchParquetData(url);
                                    const plotlyData = await parquetToPlotly(rows, displayName);
                                    Plotly.newPlot(plotChart, plotlyData.data, plotlyData.layout, {responsive: true});
                                } catch (error) {
                                    plotChart.innerHTML = `
                                        <div style="text-align: center; padding: 40px; color: var(--text-secondary);">
                                            <p>Error loading plot: ${error.message}</p>
                                            <p style="font-size: 0.9em; margin-top: 10px;">This file might be too large or in an unsupported format.</p>
                                        </div>
                                    `;
                                }
                            };
                        }
                    })
                    .catch(error => {
                        plotContainer.innerHTML = `
                            <div style="padding: 40px; text-align: center; color: var(--text-secondary);">
                                <p>Error loading data: ${error.message}</p>
                            </div>
                        `;
                    });
            }
            // Handle parquet files - fetch and render directly
            else if (plotData.type === 'parquet') {
                plotContainer.innerHTML = `
                    <div style="padding: 20px; text-align: center;">
                        <p style="margin-bottom: 20px; color: var(--text-secondary);">
                            Loading parquet file from repository...
                        </p>
                        <div class="spinner" style="margin: 20px auto; width: 40px; height: 40px; border: 4px solid #f3f3f3; border-top: 4px solid var(--accent-primary); border-radius: 50%; animation: spin 1s linear infinite;"></div>
                    </div>
                `;
                
                // Fetch and render parquet file
                fetchParquetData(plotItem.repo_name, plotItem.file_path)
                    .then(({ rows, arrayBuffer }) => {
                        const plotlyData = parquetToPlotly(rows);
                        
                        if (plotlyData) {
                            // Store arrayBuffer for download
                            plotContainer.dataset.parquetData = 'loaded';
                            plotContainer.parquetBuffer = arrayBuffer;
                            
                            // Render with Plotly
                            Plotly.newPlot(`plot-container-${index}`, plotlyData.data, plotlyData.layout, {responsive: true});
                        } else {
                            // Show data table if we can't auto-plot
                            const columns = Object.keys(rows[0]);
                            let tableHTML = `
                                <div style="padding: 20px; overflow: auto;">
                                    <p style="margin-bottom: 15px; color: var(--text-secondary);">
                                        <strong>${rows.length}</strong> rows × <strong>${columns.length}</strong> columns
                                    </p>
                                    <table style="width: 100%; border-collapse: collapse; font-size: 0.9em;">
                                        <thead>
                                            <tr style="background: var(--bg-secondary); border-bottom: 2px solid var(--border-primary);">
                                                ${columns.map(col => `<th style="padding: 8px; text-align: left;">${col}</th>`).join('')}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            ${rows.slice(0, 50).map(row => `
                                                <tr style="border-bottom: 1px solid var(--border-primary);">
                                                    ${columns.map(col => `<td style="padding: 8px;">${row[col]}</td>`).join('')}
                                                </tr>
                                            `).join('')}
                                        </tbody>
                                    </table>
                                    ${rows.length > 50 ? `<p style="margin-top: 10px; color: var(--text-secondary);">Showing first 50 rows...</p>` : ''}
                                </div>
                            `;
                            plotContainer.innerHTML = tableHTML;
                        }
                    })
                    .catch(error => {
                        plotContainer.innerHTML = `
                            <div style="padding: 20px; color: var(--text-secondary);">
                                <p style="color: red; margin-bottom: 10px;">Error loading parquet file</p>
                                <p>${error.message}</p>
                                <p style="margin-top: 15px; font-size: 0.9em;">
                                    File path: <code>${plotItem.file_path}</code>
                                </p>
                            </div>
                        `;
                    });
            }
            // Handle different JSON formats from Analysis Toolbox
            else if (plotData.data && plotData.layout) {
                // Plotly JSON format (preferred)
                Plotly.newPlot(`plot-container-${index}`, plotData.data, plotData.layout, {responsive: true});
            } else if (Array.isArray(plotData)) {
                // Array of traces
                Plotly.newPlot(`plot-container-${index}`, plotData, {}, {responsive: true});
            } else if (plotData.x && plotData.y) {
                // Simple x, y data
                Plotly.newPlot(`plot-container-${index}`, [plotData], {}, {responsive: true});
            } else {
                // Unknown format - show JSON
                plotContainer.innerHTML = `
                    <pre style="background: var(--code-bg); padding: 15px; overflow: auto; border-radius: 4px; height: 100%;">
                        ${JSON.stringify(plotData, null, 2)}
                    </pre>
                `;
            }
        } catch (error) {
            plotContainer.innerHTML = `
                <div style="padding: 20px; color: var(--text-secondary);">
                    <p style="color: red; margin-bottom: 10px;">Error rendering analysis: ${error.message}</p>
                    <details>
                        <summary style="cursor: pointer; margin-bottom: 10px;">View raw JSON</summary>
                        <pre style="background: var(--bg-tertiary); padding: 15px; overflow: auto; border-radius: 4px;">
                            ${JSON.stringify(plotItem.plot_data, null, 2)}
                        </pre>
                    </details>
                </div>
            `;
        }
    });
}

// Build hierarchical file tree (EmotiView style) for parquet data files
function buildAnalysisFileTree() {
    console.log('[Analysis] buildAnalysisFileTree() called');
    const fileTree = document.getElementById('file-tree');
    console.log('[Analysis] file-tree element:', fileTree);
    
    const  { repoName, byParticipant } = window.analysisData;
    console.log('[Analysis] Building tree for repo:', repoName);
    console.log('[Analysis] Participants:', Object.keys(byParticipant));
    
    const participantKeys = Object.keys(byParticipant).sort();
    
    // Build tree structure: Project > Participants > Files
    let html = `
        <div class="tree-folder" onclick="toggleFolder(this)" data-expanded="false">
            <span class="tree-folder-icon">▶</span>
            <span>${repoName}</span>
        </div>
        <div class="tree-folder-content" style="margin-left: 10px;">
    `;
    
    participantKeys.forEach(participant => {
        const files = byParticipant[participant];
        html += `
            <div class="tree-folder" onclick="toggleFolder(this)" data-expanded="false">
                <span class="tree-folder-icon">▶</span>
                <span>${participant}</span>
                <span style="color: var(--text-muted, #999); font-size: 0.85em; margin-left: 5px;">(${files.length})</span>
            </div>
            <div class="tree-folder-content" style="margin-left: 10px;">
        `;
        
        files.forEach(file => {
            html += `
                <div class="tree-item" onclick="loadPlotFile('${file.url}', '${file.filename}', '${participant}')" data-filename="${file.filename.toLowerCase()}">
                    ${file.filename}
                    <span style="color: var(--text-muted, #999); font-size: 0.8em; margin-left: 5px;">
                        (${(file.size / 1024).toFixed(1)}KB)
                    </span>
                </div>
            `;
        });
        
        html += `
            </div>
        `;
    });
    
    html += `
        </div>
    `;
    
    console.log('[Analysis] Setting fileTree.innerHTML with', participantKeys.length, 'participants');
    fileTree.innerHTML = html;
    console.log('[Analysis] File tree HTML set successfully');
}

// Fetch and parse pipeline trace file
async function fetchPipelineTrace(repoPath, resultsDir) {
    try {
        const traceUrl = `https://raw.githubusercontent.com/${repoPath}/main/${resultsDir}/.bin/pipeline_trace.txt`;
        console.log('[Pipeline] Fetching trace from:', traceUrl);
        
        const response = await fetch(traceUrl);
        if (!response.ok) {
            console.warn('[Pipeline] Trace file not found or inaccessible');
            return;
        }
        
        const text = await response.text();
        const pipeline = parsePipelineTrace(text);
        
        if (pipeline && pipeline.processes.length > 0) {
            // Store per-repo so each project gets its own pipeline
            if (!window.pipelineDataMap) window.pipelineDataMap = {};
            window.pipelineDataMap[repoPath] = pipeline;
            // Keep legacy global for backward compat (last loaded)
            window.pipelineData = pipeline;
            console.log('[Pipeline] Loaded pipeline for', repoPath, 'with', pipeline.processes.length, 'modules');
        }
    } catch (error) {
        console.warn('[Pipeline] Could not load pipeline trace:', error);
    }
}

// Parse pipeline trace TSV file to extract module connections
function parsePipelineTrace(traceText) {
    const lines = traceText.trim().split('\n');
    if (lines.length < 2) return { processes: [], edges: [] };
    const headers = lines[0].split('\t');
    const processIdx = headers.indexOf('process');
    const statusIdx = headers.indexOf('status');
    if (processIdx === -1) return { processes: [], edges: [] };

    const processMap = new Map();
    for (let i = 1; i < lines.length; i++) {
        const fields = lines[i].split('\t');
        const process = fields[processIdx]?.trim();
        const status = statusIdx !== -1 ? (fields[statusIdx]?.trim() || '') : '';
        if (!process) continue;
        if (!processMap.has(process)) processMap.set(process, { count: 0, failed: false });
        const entry = processMap.get(process);
        entry.count++;
        if (status === 'FAILED') entry.failed = true;
    }

    const processes = Array.from(processMap.entries()).map(([name, data]) => {
        let dn = name
            .replace(/_processor$/, '').replace(/_file_finder$/, ' (find)')
            .replace('_concatenating', ' concat').replace('_transform', '')
            .replace('_filtering', ' filt').replace('_epoching', ' epoch')
            .replace('_rejection', ' rej').replace('_windowing', ' win')
            .replace('_detection', ' det').replace('_amplitude', ' amp');
        return { name, displayName: dn, failed: data.failed };
    });

    // Infer edges from process name patterns
    const nameSet = new Set(processes.map(p => p.name));
    const edgeSet = new Set();
    const edges = [];
    const add = (from, to) => {
        if (from && to && from !== to && nameSet.has(from) && nameSet.has(to)) {
            const k = from + '>' + to;
            if (!edgeSet.has(k)) { edgeSet.add(k); edges.push({ from, to }); }
        }
    };

    for (const p of processes) {
        const n = p.name;
        // Survey track: txt_reader -> tree_processor -> analyzers -> file_finders -> concat
        if (n === 'tree_processor') add('txt_reader', n);
        if (/^(sam|ea11|be7|panas|bisbas|condprof)_analyzer$/.test(n)) add('tree_processor', n);
        if (/^(sam|ea11|be7|panas|bisbas|condprof)\d_file_finder$/.test(n)) {
            const prefix = n.replace(/\d_file_finder$/, '');
            add(prefix + '_analyzer', n);
        }
        if (/^(sam|ea11|be7|panas|bisbas|condprof)_concatenating_processor$/.test(n)) {
            const prefix = n.replace('_concatenating_processor', '');
            for (const o of processes) {
                if (o.name.startsWith(prefix) && o.name.endsWith('_file_finder') && !o.name.includes('agg')) add(o.name, n);
            }
        }

        // XDF track: xdf_reader -> extracting_processor -> signal file_finders
        if (n === 'extracting_processor') add('xdf_reader', n);
        if (/^(fnirs|ecg|eda|eeg|trigger|aux)_file_finder$/.test(n)) add('extracting_processor', n);

        // Events: trigger_file_finder + tree_processor -> events_processor
        if (n === 'events_processor') { add('trigger_file_finder', n); add('tree_processor', n); }

        // fNIRS chain
        if (n === 'log_transform_processor') add('fnirs_file_finder', n);
        if (n === 'tddr_processor') add('log_transform_processor', n);
        if (n === 'regression_processor') add('tddr_processor', n);
        if (n === 'linear_transform_processor') add('regression_processor', n);
        if (n === 'fnirs_filtering_processor') add('linear_transform_processor', n);
        if (n === 'fnirs_epoching_processor') { add('fnirs_filtering_processor', n); add('events_processor', n); }
        if (n === 'amplitude_analyzer') add('fnirs_epoching_processor', n);
        if (/^fnirs\d_file_finder$/.test(n)) add('amplitude_analyzer', n);
        if (/^fnirs_hbc\d_amplitude_analyzer$/.test(n)) {
            const num = n.match(/\d/)[0]; add('fnirs' + num + '_file_finder', n);
        }
        if (/^fnirs_hbc\d_agg_file_finder$/.test(n)) {
            const num = n.match(/\d/)[0]; add('fnirs_hbc' + num + '_amplitude_analyzer', n);
        }
        if (/^fnirs_asym\d_analyzer$/.test(n)) {
            const num = n.match(/\d/)[0]; add('fnirs_hbc' + num + '_agg_file_finder', n);
        }
        if (n === 'fnirs_concatenating_processor') {
            for (const o of processes) if (/^fnirs_hbc\d_agg_file_finder$/.test(o.name)) add(o.name, n);
        }
        if (n === 'fnirs_asym_concatenating_processor') {
            for (const o of processes) if (/^fnirs_asym\d_analyzer$/.test(o.name)) add(o.name, n);
        }

        // ECG chain: ecg_file_finder -> ecg_filtering -> hrv_rejection -> peak_detection -> ecg_epoching -> ecg_windowing
        if (n === 'ecg_filtering_processor') add('ecg_file_finder', n);
        if (n === 'hrv_rejection_processor') add('ecg_filtering_processor', n);
        if (n === 'peak_detection_processor') add('hrv_rejection_processor', n);
        if (n === 'ecg_epoching_processor') { add('peak_detection_processor', n); add('events_processor', n); }
        if (n === 'ecg_windowing_processor') add('ecg_epoching_processor', n);
        if (n === 'hrv_ols_processor') add('ecg_windowing_processor', n);
        if (/^hrv\d_file_finder$/.test(n)) add('hrv_ols_processor', n);
        if (n === 'hrv_concatenating_processor') {
            for (const o of processes) if (/^hrv\d_file_finder$/.test(o.name)) add(o.name, n);
        }
        if (n === 'hrv_bootstrap_analyzer') add('hrv_concatenating_processor', n);

        // EDA chain: eda_file_finder -> eda_filtering -> eda_rejection -> eda_epoching -> eda_windowing
        if (n === 'eda_filtering_processor') add('eda_file_finder', n);
        if (n === 'eda_rejection_processor') add('eda_filtering_processor', n);
        if (n === 'eda_epoching_processor') { add('eda_rejection_processor', n); add('events_processor', n); }
        if (n === 'eda_windowing_processor') add('eda_epoching_processor', n);
        if (/^eda\d_file_finder$/.test(n)) add('eda_windowing_processor', n);
        if (n === 'eda_concatenating_processor') {
            for (const o of processes) if (/^eda\d_file_finder$/.test(o.name)) add(o.name, n);
        }
        if (n === 'eda_ols_processor') add('eda_concatenating_processor', n);
        if (n === 'eda_bootstrap_analyzer') add('eda_concatenating_processor', n);

        // EEG chain: eeg_file_finder -> referencing -> eeg_filtering -> ic_analyzer -> eeg_cleaned
        if (n === 'referencing_processor') add('eeg_file_finder', n);
        if (n === 'eeg_filtering_processor') add('referencing_processor', n);
        if (n === 'ic_analyzer') add('eeg_filtering_processor', n);
        if (n === 'eeg_cleaned_file_finder') add('ic_analyzer', n);
        if (n === 'eeg_epoching_processor') { add('eeg_cleaned_file_finder', n); add('events_processor', n); }
        if (n === 'psd_fai_analyzer') add('eeg_epoching_processor', n);
        // EEG ROI PSD analyzers
        if (/^eeg_roi_psd\d_analyzer$/.test(n)) add('psd_fai_analyzer', n);
        if (/^eeg_roi_psd\d_epoch_file_finder$/.test(n)) {
            const num = n.match(/\d/)[0];
            const analyzer = 'eeg_roi_psd' + num + '_analyzer';
            if (nameSet.has(analyzer)) add(analyzer, n); else add('psd_fai_analyzer', n);
        }
        // PSD raw file finders from psd_fai_analyzer
        if (/^psd\d_raw_file_finder$/.test(n)) add('psd_fai_analyzer', n);
        // FAI analyzers from psd_fai_analyzer
        if (/^fai\d_analyzer$/.test(n)) add('psd_fai_analyzer', n);
        // PSD outlier processors
        if (/^eeg_psd\d_outlier_processor$/.test(n)) {
            const num = n.match(/\d/)[0]; add('psd' + num + '_raw_file_finder', n);
        }
        // EEG concatenation
        if (n === 'eeg_psd_concatenating_processor') {
            for (const o of processes) if (/^eeg_psd\d_outlier_processor$/.test(o.name)) add(o.name, n);
            for (const o of processes) if (/^eeg_roi_psd\d_epoch_file_finder$/.test(o.name)) add(o.name, n);
        }
        if (n === 'fai_concatenating_processor') {
            for (const o of processes) if (/^fai\d_analyzer$/.test(o.name)) add(o.name, n);
        }
        if (n === 'eeg_psd_ols_processor') add('eeg_psd_concatenating_processor', n);
        if (n === 'eeg_psd_bootstrap_analyzer') add('eeg_psd_concatenating_processor', n);

        // Cross-modal: group_analyzer and interval_analyzer from events_processor
        if (n === 'group_analyzer') add('events_processor', n);
        if (n === 'interval_analyzer') add('events_processor', n);
    }

    return { processes, edges };
}

// Create a print-ready grayscale clone of the pipeline SVG
function cloneSvgForPrint() {
    const svg = document.getElementById('pipeline-dag-svg');
    if (!svg) return null;
    const clone = svg.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    // Set explicit pixel width from viewBox for export
    const vb = clone.getAttribute('viewBox');
    if (vb) {
        const parts = vb.split(/\s+/);
        clone.setAttribute('width', parts[2]);
        clone.setAttribute('height', parts[3]);
    }
    // Background: white
    const bg = clone.querySelector('rect');
    if (bg) bg.setAttribute('fill', '#ffffff');
    // Arrow markers
    clone.querySelectorAll('marker path').forEach(p => p.setAttribute('fill', '#999'));
    // Edges: medium gray
    clone.querySelectorAll('path[marker-end]').forEach(p => {
        p.setAttribute('stroke', '#bbb');
        p.setAttribute('stroke-opacity', '1');
    });
    // Nodes and text
    const rects = clone.querySelectorAll('rect[rx]');
    const texts = clone.querySelectorAll('text');
    rects.forEach(r => {
        const isProducer = r.getAttribute('stroke-width') === '1.8';
        r.setAttribute('fill', isProducer ? '#e0e0e0' : '#f5f5f5');
        r.setAttribute('stroke', isProducer ? '#333' : '#aaa');
    });
    texts.forEach(t => t.setAttribute('fill', '#222'));
    // Failed-process strikethrough lines stay as-is (#c00)
    return clone;
}

// Download pipeline SVG (grayscale for print)
function downloadPipelineSVG() {
    const clone = cloneSvgForPrint();
    if (!clone) return;
    const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'pipeline.svg';
    a.click();
    URL.revokeObjectURL(a.href);
}

// Download pipeline as greyscale PNG (2x resolution for print)
function downloadPipelinePNG() {
    const clone = cloneSvgForPrint();
    if (!clone) return;
    const svgStr = new XMLSerializer().serializeToString(clone);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();
    img.onload = () => {
        canvas.width = img.width * 2;
        canvas.height = img.height * 2;
        ctx.scale(2, 2);
        ctx.drawImage(img, 0, 0);
        canvas.toBlob(blob => {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'pipeline.png';
            a.click();
            URL.revokeObjectURL(a.href);
        }, 'image/png');
    };
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgStr)));
}

// Download pipeline as PDF (A4 landscape, greyscale, paper-ready)
async function downloadPipelinePDF() {
    const svg = document.getElementById('pipeline-dag-svg');
    if (!svg) return;
    if (typeof PDFLib === 'undefined') {
        await new Promise(resolve => {
            const check = setInterval(() => { if (typeof PDFLib !== 'undefined') { clearInterval(check); resolve(); } }, 100);
        });
    }
    const { PDFDocument, rgb } = PDFLib;
    const clone = cloneSvgForPrint();
    if (!clone) return;
    const svgStr = new XMLSerializer().serializeToString(clone);
    // Render SVG to PNG via canvas at 2x
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();
    const pngDataUrl = await new Promise((resolve) => {
        img.onload = () => {
            canvas.width = img.width * 2;
            canvas.height = img.height * 2;
            ctx.scale(2, 2);
            ctx.drawImage(img, 0, 0);
            resolve(canvas.toDataURL('image/png'));
        };
        img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgStr)));
    });
    const pngBytes = Uint8Array.from(atob(pngDataUrl.split(',')[1]), c => c.charCodeAt(0));
    const pdfDoc = await PDFDocument.create();
    const pngImage = await pdfDoc.embedPng(pngBytes);
    const pageW = 842, pageH = 595; // A4 landscape
    const page = pdfDoc.addPage([pageW, pageH]);
    const margin = 40;
    const maxW = pageW - margin * 2, maxH = pageH - margin * 2;
    const scale = Math.min(maxW / pngImage.width, maxH / pngImage.height, 1);
    const drawW = pngImage.width * scale, drawH = pngImage.height * scale;
    page.drawImage(pngImage, { x: margin, y: pageH - margin - drawH, width: drawW, height: drawH });
    pdfDoc.setTitle('Processing Pipeline');
    pdfDoc.setCreator('Open Data - 5ha99y');
    const pdfBytes = await pdfDoc.save();
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'pipeline.pdf';
    a.click();
    URL.revokeObjectURL(a.href);
}

// Dynamically determine L2 process names from the folder structure of discovered files
function getL2ProcessNames() {
    const l2Names = new Set();
    const allFiles = [];

    // Collect files from both data paths (legacy and discovery)
    if (window.analysisData?.allFiles) {
        allFiles.push(...window.analysisData.allFiles);
    } else if (window.analysisData?.repos) {
        for (const repo of window.analysisData.repos) {
            for (const files of Object.values(repo.participants)) {
                allFiles.push(...files);
            }
        }
    }

    const l2Files = allFiles.filter(f => f.level === 'l2');

    if (l2Files.length > 0 && window.pipelineData?.processes) {
        // Map l2 files to their producer processes via suffix matching
        const suffixChecks = [
            ['_concat', 'concatenating'], ['_psd', 'psd'], ['_ols', 'ols'],
            ['_windowed', 'window'], ['_epochs', 'epoch'], ['_ica', 'ica'],
            ['_filt', 'filt'], ['_fai', 'fai'], ['_hbc', 'hbc'],
            ['_hrv', 'hrv'], ['_eda', 'eda'], ['_reref', 'reref']
        ];
        for (const file of l2Files) {
            const fn = (file.name || file.filename || '').toLowerCase();
            for (const proc of window.pipelineData.processes) {
                const pl = proc.name.toLowerCase();
                for (const [fileSuffix, procMatch] of suffixChecks) {
                    if (fn.includes(fileSuffix) && pl.includes(procMatch)) {
                        l2Names.add(proc.name);
                    }
                }
                const am = fn.match(/_(be7|ea11|sam|panas|bisbas|condprof)/);
                if (am && pl.includes(am[1])) l2Names.add(proc.name);
            }
        }
    }

    // Fallback: if no folder-based L2 detected, use pattern heuristics
    if (l2Names.size === 0 && window.pipelineData?.processes) {
        const groupPatterns = [
            /concatenating/, /ols_processor/, /bootstrap/,
            /group_analyzer/, /interval_analyzer/, /asym_concatenating/,
        ];
        for (const proc of window.pipelineData.processes) {
            for (const pat of groupPatterns) {
                if (pat.test(proc.name)) { l2Names.add(proc.name); break; }
            }
        }
    }

    return l2Names;
}

// Build a single pipeline SVG from a subset of processes and edges
function buildPipelineSVG(processes, edges, producerModule, svgId) {
    const nameSet = new Set(processes.map(p => p.name));
    const filteredEdges = edges.filter(e => nameSet.has(e.from) && nameSet.has(e.to));

    // Build adjacency for layer assignment
    const childrenOf = new Map();
    const parentsOf = new Map();
    for (const p of processes) { parentsOf.set(p.name, []); childrenOf.set(p.name, []); }
    for (const e of filteredEdges) {
        parentsOf.get(e.to).push(e.from);
        childrenOf.get(e.from).push(e.to);
    }

    // Assign layers via longest path from sources
    const layerCache = new Map();
    const computing = new Set();
    function getLayer(node) {
        if (layerCache.has(node)) return layerCache.get(node);
        if (computing.has(node)) return 0;
        computing.add(node);
        const pars = parentsOf.get(node) || [];
        const layer = pars.length === 0 ? 0 : Math.max(...pars.map(getLayer)) + 1;
        layerCache.set(node, layer);
        computing.delete(node);
        return layer;
    }
    for (const p of processes) getLayer(p.name);

    // Group by layer
    const layerGroups = new Map();
    for (const p of processes) {
        const l = layerCache.get(p.name) || 0;
        if (!layerGroups.has(l)) layerGroups.set(l, []);
        layerGroups.get(l).push(p);
    }
    const sortedLayers = Array.from(layerGroups.keys()).sort((a, b) => a - b);

    // Barycenter ordering to reduce edge crossings
    // Initial order: alphabetical
    for (const li of sortedLayers) {
        layerGroups.get(li).sort((a, b) => a.displayName.localeCompare(b.displayName));
    }
    // Build index maps for barycenter calc
    function buildIndexMap(layer) {
        const m = new Map();
        const nodes = layerGroups.get(layer);
        if (nodes) nodes.forEach((p, i) => m.set(p.name, i));
        return m;
    }
    // Run 4 sweeps (down, up, down, up) for crossing reduction
    for (let sweep = 0; sweep < 4; sweep++) {
        const layers = sweep % 2 === 0 ? sortedLayers : [...sortedLayers].reverse();
        for (let li = 1; li < layers.length; li++) {
            const prevLayer = layers[li - 1];
            const curLayer = layers[li];
            const prevIdx = buildIndexMap(prevLayer);
            const curNodes = layerGroups.get(curLayer);
            // Compute barycenter for each node in current layer
            const bary = new Map();
            for (const p of curNodes) {
                const neighbors = sweep % 2 === 0
                    ? (parentsOf.get(p.name) || []).filter(n => prevIdx.has(n))
                    : (childrenOf.get(p.name) || []).filter(n => prevIdx.has(n));
                if (neighbors.length > 0) {
                    bary.set(p.name, neighbors.reduce((s, n) => s + prevIdx.get(n), 0) / neighbors.length);
                } else {
                    bary.set(p.name, curNodes.indexOf(p));
                }
            }
            curNodes.sort((a, b) => bary.get(a.name) - bary.get(b.name));
        }
    }

    // Node dimensions
    const nodeH = 28;
    const hGap = 16;
    const vGap = 50;
    const padX = 20;
    const padY = 20;
    const maxRowWidth = 1100;
    const fontSize = 9;
    const nodeWidths = new Map();
    for (const p of processes) {
        nodeWidths.set(p.name, Math.max(70, p.displayName.length * 5.5 + 22));
    }

    // Position nodes — wrap long layers into sub-rows
    const positions = new Map();
    let maxLayerW = 0;
    let totalLayerRows = 0;

    for (const li of sortedLayers) {
        const nodes = layerGroups.get(li);

        let subRow = 0;
        let x = padX;
        for (const p of nodes) {
            const w = nodeWidths.get(p.name);
            if (x > padX && x + w > maxRowWidth) {
                subRow++;
                x = padX;
            }
            const y = padY + (totalLayerRows + subRow) * (nodeH + vGap);
            positions.set(p.name, { x, y, w, h: nodeH });
            x += w + hGap;
            if (x - hGap > maxLayerW) maxLayerW = x - hGap;
        }
        totalLayerRows += subRow + 1;
    }

    const svgW = Math.max(maxLayerW + padX, 400);
    const svgH = padY * 2 + totalLayerRows * (nodeH + vGap) - vGap;

    // Compute distributed edge ports per node
    // outPorts: bottom of source node, inPorts: top of target node
    const outEdges = new Map(); // node -> list of edges leaving (sorted by target x)
    const inEdges = new Map();  // node -> list of edges arriving (sorted by source x)
    for (const e of filteredEdges) {
        if (!outEdges.has(e.from)) outEdges.set(e.from, []);
        outEdges.get(e.from).push(e);
        if (!inEdges.has(e.to)) inEdges.set(e.to, []);
        inEdges.get(e.to).push(e);
    }
    // Sort and assign x offsets
    for (const [node, edgeList] of outEdges) {
        edgeList.sort((a, b) => {
            const pa = positions.get(a.to), pb = positions.get(b.to);
            return (pa ? pa.x + pa.w / 2 : 0) - (pb ? pb.x + pb.w / 2 : 0);
        });
    }
    for (const [node, edgeList] of inEdges) {
        edgeList.sort((a, b) => {
            const pa = positions.get(a.from), pb = positions.get(b.from);
            return (pa ? pa.x + pa.w / 2 : 0) - (pb ? pb.x + pb.w / 2 : 0);
        });
    }

    function getOutPortX(edge) {
        const pos = positions.get(edge.from);
        const list = outEdges.get(edge.from) || [edge];
        const idx = list.indexOf(edge);
        const n = list.length;
        const margin = Math.min(pos.w * 0.15, 10);
        const usableW = pos.w - 2 * margin;
        return pos.x + margin + (n === 1 ? usableW / 2 : (idx / (n - 1)) * usableW);
    }
    function getInPortX(edge) {
        const pos = positions.get(edge.to);
        const list = inEdges.get(edge.to) || [edge];
        const idx = list.indexOf(edge);
        const n = list.length;
        const margin = Math.min(pos.w * 0.15, 10);
        const usableW = pos.w - 2 * margin;
        return pos.x + margin + (n === 1 ? usableW / 2 : (idx / (n - 1)) * usableW);
    }

    // Read CSS custom properties for theme-aware SVG
    const cs = getComputedStyle(document.documentElement);
    const thBg = cs.getPropertyValue('--bg-tertiary').trim() || '#1c1c1c';
    const thNodeFill = cs.getPropertyValue('--bg-elevated').trim() || '#242424';
    const thNodeStroke = cs.getPropertyValue('--border-primary').trim() || '#2a2a2a';
    const thProdFill = cs.getPropertyValue('--bg-secondary').trim() || '#161616';
    const thProdStroke = cs.getPropertyValue('--accent-primary').trim() || '#c9a227';
    const thText = cs.getPropertyValue('--text-primary').trim() || '#e8e8e8';
    const thMuted = cs.getPropertyValue('--text-muted').trim() || '#6a6a6a';

    let svg = '';
    svg += '<svg id="' + svgId + '" xmlns="http://www.w3.org/2000/svg" ';
    svg += 'width="' + svgW + '" height="' + svgH + '" ';
    svg += 'viewBox="0 0 ' + svgW + ' ' + svgH + '" ';
    svg += "style=\"font-family:'Segoe UI',Helvetica,Arial,sans-serif;\">";
    svg += '<rect width="' + svgW + '" height="' + svgH + '" fill="' + thBg + '"/>';
    svg += '<defs><marker id="dag-arrow-' + svgId + '" viewBox="0 0 10 8" refX="10" refY="4" markerWidth="5" markerHeight="4" orient="auto">';
    svg += '<path d="M0,0 L10,4 L0,8 z" fill="' + thMuted + '"/></marker></defs>';

    // Edges — distributed ports + smooth cubic bezier
    for (const e of filteredEdges) {
        const from = positions.get(e.from);
        const to = positions.get(e.to);
        if (!from || !to) continue;
        const x1 = getOutPortX(e), y1 = from.y + from.h;
        const x2 = getInPortX(e), y2 = to.y;
        const dy = y2 - y1;
        const cy1 = y1 + dy * 0.35, cy2 = y2 - dy * 0.35;
        svg += '<path d="M' + x1.toFixed(1) + ',' + y1 + ' C' + x1.toFixed(1) + ',' + cy1.toFixed(1) + ' ' + x2.toFixed(1) + ',' + cy2.toFixed(1) + ' ' + x2.toFixed(1) + ',' + y2 + '" fill="none" stroke="' + thMuted + '" stroke-width="0.9" stroke-opacity="0.45" marker-end="url(#dag-arrow-' + svgId + ')"/>';
    }

    // Nodes
    for (const p of processes) {
        const pos = positions.get(p.name);
        if (!pos) continue;
        const isProd = p.name === producerModule;
        const fill = isProd ? thProdFill : thNodeFill;
        const stroke = isProd ? thProdStroke : thNodeStroke;
        const sw = isProd ? '1.8' : '0.8';
        const fw = isProd ? 'bold' : 'normal';
        svg += '<rect x="' + pos.x + '" y="' + pos.y + '" width="' + pos.w + '" height="' + pos.h + '" rx="4" ry="4" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + sw + '"/>';
        svg += '<text x="' + (pos.x + pos.w / 2) + '" y="' + (pos.y + pos.h / 2 + 3.5) + '" text-anchor="middle" font-size="' + fontSize + '" font-weight="' + fw + '" fill="' + thText + '">' + p.displayName + '</text>';
        if (p.failed) {
            svg += '<line x1="' + pos.x + '" y1="' + pos.y + '" x2="' + (pos.x + pos.w) + '" y2="' + (pos.y + pos.h) + '" stroke="#c00" stroke-width="1" opacity="0.5"/>';
        }
    }
    svg += '</svg>';
    return { svg, processCount: processes.length, edgeCount: filteredEdges.length };
}

// Generate SVG-based DAG pipeline tree — dynamically split into L1/L2 if folder structure indicates it
function generatePipelineTreeHTML(filename, pipelineData) {
    if (!pipelineData || !pipelineData.processes || pipelineData.processes.length === 0) return '';

    const { processes, edges } = pipelineData;
    const lowerFilename = (filename || '').toLowerCase();

    // Identify producer module
    let producerModule = null;
    if (lowerFilename) {
        const suffixChecks = [
            ['_concat', 'concatenating'], ['_psd', 'psd'], ['_ols', 'ols'],
            ['_windowed', 'window'], ['_epochs', 'epoch'], ['_ica', 'ica'],
            ['_filt', 'filt'], ['_fai', 'fai'], ['_hbc', 'hbc'],
            ['_hrv', 'hrv'], ['_eda', 'eda'], ['_reref', 'reref']
        ];
        for (const process of processes) {
            const pl = process.name.toLowerCase();
            for (const [fileSuffix, procMatch] of suffixChecks) {
                if (lowerFilename.includes(fileSuffix) && pl.includes(procMatch)) { producerModule = process.name; break; }
            }
            if (producerModule) break;
            const am = lowerFilename.match(/_(be7|ea11|sam|panas|bisbas|condprof)/);
            if (am && pl.includes(am[1])) { producerModule = process.name; break; }
        }
    }

    // Determine L1 vs L2 processes
    const l2Names = getL2ProcessNames();
    const l1Processes = l2Names.size > 0 ? processes.filter(p => !l2Names.has(p.name)) : processes;
    const displayL1 = l1Processes.length > 0 ? l1Processes : processes;
    const l2Processes = l2Names.size > 0 ? processes.filter(p => l2Names.has(p.name)) : [];

    // --- L1 Pipeline ---
    const resultL1 = buildPipelineSVG(displayL1, edges, producerModule, 'pipeline-dag-svg');
    let html = '<div style="margin-bottom: 15px;">'
        + '<div style="font-size: 0.85rem; font-weight: 600; color: var(--text-primary, #e8e8e8); margin-bottom: 8px;">Processing Pipeline' + (l2Processes.length > 0 ? ' (Participant Level)' : '') + '</div>'
        + '<div class="export-bar">'
        + '<button class="export-btn png" onclick="downloadPipelinePNG()">&#8659; PNG</button>'
        + '<button class="export-btn svg" onclick="downloadPipelineSVG()">&#8659; SVG</button>'
        + '<button class="export-btn pdf" onclick="downloadPipelinePDF()">&#8659; PDF</button>'
        + '<button class="export-btn" onclick="pipelineZoom(1)" style="margin-left: 12px;" title="Zoom in">&#43;</button>'
        + '<button class="export-btn" onclick="pipelineZoom(-1)" title="Zoom out">&#8722;</button>'
        + '<button class="export-btn" onclick="pipelineZoom(0)" title="Reset zoom">&#8634;</button>'
        + '<span style="font-size: 0.75rem; color: var(--text-muted, #999); margin-left: auto;">' + resultL1.processCount + ' modules, ' + resultL1.edgeCount + ' connections</span>'
        + '</div>'
        + '<div id="pipeline-zoom-container" style="padding: 15px; background: var(--bg-tertiary, #f5f5f5); border-radius: 8px; border: 1px solid var(--border-primary, #ddd); overflow: hidden; max-height: 700px; cursor: grab; position: relative;">'
        + '<div id="pipeline-zoom-inner" style="transform-origin: 0 0; transition: transform 0.1s ease; user-select: none;">' + resultL1.svg + '</div>';
    if (producerModule && !l2Names.has(producerModule)) {
        html += '<div style="margin-top: 8px; font-size: 0.7rem; color: var(--text-muted, #999);">'
            + '<span style="display: inline-block; width: 14px; height: 10px; background: var(--bg-secondary, #161616); border: 1.8px solid var(--accent-primary, #c9a227); border-radius: 2px; vertical-align: middle; margin-right: 4px;"></span>'
            + 'Highlighted: module that produced this file'
            + '</div>';
    }
    html += '</div></div>';

    // --- L2 Pipeline (only if L2 processes exist) ---
    if (l2Processes.length > 0) {
        const resultL2 = buildPipelineSVG(l2Processes, edges, producerModule, 'pipeline-dag-svg-l2');
        html += '<hr style="border: none; border-top: 1px solid var(--border-primary, #2a2a2a); margin: 20px 0;">';
        html += '<div style="margin-bottom: 15px;">'
            + '<div style="font-size: 0.85rem; font-weight: 600; color: var(--text-primary, #e8e8e8); margin-bottom: 8px;">Processing Pipeline (Group Level)</div>'
            + '<div class="export-bar">'
            + '<button class="export-btn png" onclick="downloadPipelinePNG(\'l2\')">&#8659; PNG</button>'
            + '<button class="export-btn svg" onclick="downloadPipelineSVG(\'l2\')">&#8659; SVG</button>'
            + '<button class="export-btn pdf" onclick="downloadPipelinePDF(\'l2\')">&#8659; PDF</button>'
            + '<button class="export-btn" onclick="pipelineZoom(1,\'l2\')" style="margin-left: 12px;" title="Zoom in">&#43;</button>'
            + '<button class="export-btn" onclick="pipelineZoom(-1,\'l2\')" title="Zoom out">&#8722;</button>'
            + '<button class="export-btn" onclick="pipelineZoom(0,\'l2\')" title="Reset zoom">&#8634;</button>'
            + '<span style="font-size: 0.75rem; color: var(--text-muted, #999); margin-left: auto;">' + resultL2.processCount + ' modules, ' + resultL2.edgeCount + ' connections</span>'
            + '</div>'
            + '<div id="pipeline-zoom-container-l2" style="padding: 15px; background: var(--bg-tertiary, #f5f5f5); border-radius: 8px; border: 1px solid var(--border-primary, #ddd); overflow: hidden; max-height: 700px; cursor: grab; position: relative;">'
            + '<div id="pipeline-zoom-inner-l2" style="transform-origin: 0 0; transition: transform 0.1s ease; user-select: none;">' + resultL2.svg + '</div>';
        if (producerModule && l2Names.has(producerModule)) {
            html += '<div style="margin-top: 8px; font-size: 0.7rem; color: var(--text-muted, #999);">'
                + '<span style="display: inline-block; width: 14px; height: 10px; background: var(--bg-secondary, #161616); border: 1.8px solid var(--accent-primary, #c9a227); border-radius: 2px; vertical-align: middle; margin-right: 4px;"></span>'
                + 'Highlighted: module that produced this file'
                + '</div>';
        }
        html += '</div></div>';
    }

    return html;
}

// Toggle folder expand/collapse
function toggleFolder(element) {
    const icon = element.querySelector('.tree-folder-icon');
    const content = element.nextElementSibling;
    const isExpanded = element.dataset.expanded === 'true';
    
    if (isExpanded) {
        icon.style.transform = 'rotate(0deg)';
        content.classList.remove('expanded');
        element.dataset.expanded = 'false';
    } else {
        icon.style.transform = 'rotate(90deg)';
        content.classList.add('expanded');
        element.dataset.expanded = 'true';
    }
}

// Filter file tree based on search query
function filterFileTree(query) {
    const fileTree = document.getElementById('file-tree');
    const allItems = fileTree.querySelectorAll('.tree-item');
    const allFolders = fileTree.querySelectorAll('.tree-folder');
    
    if (!query || query.trim() === '') {
        // Show all items
        allItems.forEach(item => item.style.display = '');
        allFolders.forEach(folder => folder.style.display = '');
        return;
    }
    
    const searchLower = query.toLowerCase();
    
    // Filter items
    allItems.forEach(item => {
        const filename = item.dataset.filename || '';
        const matches = filename.includes(searchLower);
        item.style.display = matches ? '' : 'none';
    });
    
    // Show/hide folders based on visible children
    allFolders.forEach(folder => {
        const content = folder.nextElementSibling;
        if (content && content.classList.contains('tree-folder-content')) {
            const visibleChildren = Array.from(content.querySelectorAll('.tree-item'))
                .filter(item => item.style.display !== 'none');
            
            if (visibleChildren.length > 0) {
                folder.style.display = '';
                // Auto-expand folders with matches
                folder.dataset.expanded = 'true';
                content.classList.add('expanded');
                const icon = folder.querySelector('.tree-folder-icon');
                if (icon) icon.style.transform = 'rotate(90deg)';
            } else {
                folder.style.display = 'none';
            }
        }
    });
}

// Load and display a plot file when clicked
async function loadPlotFile(url, displayName, participant) {
    console.log('[Analysis] loadPlotFile called:', { url, displayName, participant });
    
    const emptyState = document.getElementById('empty-state');
    const plotDisplays = document.getElementById('plot-displays');
    
    if (!emptyState || !plotDisplays) {
        console.error('[Analysis] Required DOM elements not found');
        return;
    }
    
    // Remove previous active states
    document.querySelectorAll('.tree-item.active').forEach(item => {
        item.classList.remove('active');
    });
    
    // Mark clicked item as active
    if (event && event.target) {
        event.target.closest('.tree-item').classList.add('active');
    }
    
    // Find file size from analysisData
    let fileSize = 0;
    if (window.analysisData && window.analysisData.allFiles) {
        const file = window.analysisData.allFiles.find(f => f.url === url);
        if (file) {
            fileSize = file.size;
            console.log('[Analysis] Found file size:', fileSize, 'bytes');
        } else {
            console.warn('[Analysis] File not found in analysisData:', url);
        }
    } else {
        console.warn('[Analysis] analysisData not available');
    }
    
    const fileSizeStr = fileSize >= 1024 * 1024
        ? (fileSize / (1024 * 1024)).toFixed(1) + ' MB'
        : fileSize > 0 ? (fileSize / 1024).toFixed(1) + ' KB' : '';
    const isLargeFile = fileSize > 10 * 1024 * 1024; // > 10MB
    const isVeryLargeFile = fileSize > 50 * 1024 * 1024; // > 50MB
    
    // Hide empty state
    emptyState.style.display = 'none';
    
    // Create plot display with size warning
    let sizeWarning = '';
    if (isVeryLargeFile) {
        sizeWarning = `
            <div style="background: #fff3cd; border: 1px solid #ffc107; border-radius: 5px; padding: 10px; margin-bottom: 15px; font-size: 0.85rem;">
                <strong>Large File Warning:</strong> This file is ${fileSizeStr}. Loading may take 1-2 minutes and requires significant memory.
                <br><span style="font-size: 0.8rem; color: #856404;">Data files are highly compressed but may still be large. Please be patient.</span>
            </div>
        `;
    } else if (isLargeFile) {
        sizeWarning = `
            <div style="background: #d1ecf1; border: 1px solid #17a2b8; border-radius: 5px; padding: 8px; margin-bottom: 12px; font-size: 0.8rem;">
                <strong>Info:</strong> This file is ${fileSizeStr} and may take 10-30 seconds to load.
            </div>
        `;
    }
    
    // Generate pipeline tree HTML if available — resolve correct repo
    const repoPath = url.replace('https://raw.githubusercontent.com/', '').split('/').slice(0, 2).join('/');
    const pipelineForRepo = (window.pipelineDataMap && window.pipelineDataMap[repoPath]) || window.pipelineData;
    const pipelineHTML = pipelineForRepo 
        ? generatePipelineTreeHTML(displayName, pipelineForRepo)
        : '';
    
    // Create plot display — plot first (specific), then pipeline tree (global overview) below
    const divider = '<hr style="border: none; border-top: 1px solid var(--border-primary, #2a2a2a); margin: 25px 0;">';
    plotDisplays.innerHTML = `
        <div class="plot-display active" id="current-plot">
            <div style="margin-bottom: 20px;">
                <div style="font-size: 0.85rem; font-weight: 600; color: var(--text-primary, #e8e8e8); margin-bottom: 8px;">Data Visualization</div>
                ${sizeWarning}
                <div class="export-bar">
                    <button class="export-btn png" onclick="exportPlotAsPNG('current-plot-chart')">
                        &#8659; PNG
                    </button>
                    <button class="export-btn svg" onclick="exportPlotAsSVG('current-plot-chart')">
                        &#8659; SVG
                    </button>
                    <button class="export-btn pdf" onclick="exportPlotAsPDF('current-plot-chart', '${participant}', '${displayName}')">
                        &#8659; PDF
                    </button>
                    <span id="load-status" style="color: var(--text-muted, #999); font-size: 0.85rem; margin-left: auto;">
                        Preparing...${fileSizeStr ? ' (' + fileSizeStr + ')' : ''}
                    </span>
                </div>
            </div>
            <div id="current-plot-chart" style="width: 100%; height: calc(100vh - 300px); min-height: 500px;background: var(--bg-secondary, #f8f8f8); border: 1px solid var(--border-primary, #ddd); border-radius: 8px; overflow: hidden;">
                <div style="display: flex; align-items: center; justify-content: center; height: 100%; flex-direction: column; gap: 15px;">
                    <div class="spinner" style="width: 50px; height: 50px; border: 5px solid var(--bg-tertiary, #ddd); border-top: 5px solid var(--accent-primary, #c9a227); border-radius: 50%; animation: spin 1s linear infinite;"></div>
                    <p id="load-progress" style="color: var(--text-secondary, #666); font-size: 0.95rem;">Fetching${fileSizeStr ? ' ' + fileSizeStr : ''} file from GitHub...</p>
                    <p style="color: var(--text-muted, #999); font-size: 0.8rem;">Large files may take a moment to load</p>
                </div>
            </div>
            ${pipelineHTML ? divider + pipelineHTML : ''}
        </div>
    `;
    
    console.log('[Analysis] Plot display created, starting data fetch...');
    
    try {
        const startTime = Date.now();
        
        console.log('[Analysis] Entering try block, calling fetchParquetData...');
        
        // Update progress: downloading
        const progressEl = document.getElementById('load-progress');
        if (progressEl) progressEl.textContent = `Downloading${fileSizeStr ? ' ' + fileSizeStr : ''}...`;
        
        const { rows } = await fetchParquetData(url, fileSize);
        
        // Update progress: parsing
        const downloadTime = ((Date.now() - startTime) / 1000).toFixed(1);
        if (progressEl) progressEl.textContent = `Downloaded in ${downloadTime}s. Parsing parquet data...`;
        
        const plotlyData = await parquetToPlotly(rows, displayName);
        
        // Update progress: rendering
        if (progressEl) progressEl.textContent = `Rendering ${plotlyData.data.length} trace(s)...`;
        
        const chartDiv = document.getElementById('current-plot-chart');
        await Plotly.newPlot(chartDiv, plotlyData.data, plotlyData.layout, {responsive: true});
        
        // Update status
        const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
        const statusSpan = document.getElementById('load-status');
        if (statusSpan) {
            statusSpan.textContent = `Loaded in ${totalTime}s${fileSizeStr ? ' (' + fileSizeStr + ')' : ''}`;
            statusSpan.style.color = 'var(--accent-primary, #28a745)';
        }
    } catch (error) {
        console.error('[Analysis] Error loading plot:', error);
        const chartDiv = document.getElementById('current-plot-chart');
        const statusSpan = document.getElementById('load-status');
        
        if (statusSpan) {
            statusSpan.textContent = 'Failed to load';
            statusSpan.style.color = '#dc3545';
        }
        
        // Provide more specific error messages
        let errorDetails = error.message;
        let recommendations = '';
        
        if (error.message.includes('LFS_POINTER')) {
            errorDetails = 'Data not yet available';
            recommendations = 'The source repository contains placeholder files instead of actual data. This is resolved automatically when the research pipeline redeploys. Please check back shortly.';
        } else if (error.message.includes('Parquet library failed')) {
            errorDetails = 'Parquet library could not load';
            recommendations = 'Please check your internet connection and try refreshing the page.';
        } else if (error.message.includes('HTTP 404')) {
            errorDetails = 'File not found on GitHub';
            recommendations = 'The parquet file may have been moved or deleted.';
        } else if (error.message.includes('out of memory') || error.message.includes('allocation')) {
            errorDetails = 'Browser ran out of memory';
            recommendations = 'This data file is too large for browser processing. Try closing other tabs or using a smaller time window.';
        } else if (fileSize > 100 * 1024 * 1024) {
            recommendations = 'Files over 100MB may be too large for browser-based visualization. Consider pre-processing the data into smaller segments.';
        } else {
            recommendations = 'This file might be corrupted or in an unsupported format.';
        }
        
        chartDiv.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: center; height: 100%; flex-direction: column; padding: 40px; text-align: center;">
                <p style="color: var(--text-secondary, #666); font-size: 1.1rem; margin-bottom: 10px;">Error loading plot</p>
                <p style="color: var(--text-muted, #999); font-size: 0.9rem; max-width: 500px;">${errorDetails}</p>
                <p style="color: var(--text-muted, #999); font-size: 0.85rem; margin-top: 15px; max-width: 500px;">
                    ${recommendations}
                </p>
                ${fileSize > 10 * 1024 * 1024 ? `<p style="color: var(--text-muted, #999); font-size: 0.8rem; margin-top: 10px;">File size: ${fileSizeStr}</p>` : ''}
            </div>
        `;
    }
}

// Grayscale color palette for print-friendly exports
const PRINT_GRAYS = [
    '#222222', '#666666', '#999999', '#444444', '#bbbbbb',
    '#333333', '#777777', '#555555', '#aaaaaa', '#888888',
];

// Apply print-friendly layout overrides and export, then restore original
async function exportPlotWithPrintLayout(plotDiv, exportFn) {
    // Capture current layout
    const origLayout = JSON.parse(JSON.stringify(plotDiv.layout || {}));
    const origData = plotDiv.data ? plotDiv.data.map(t => ({
        'marker.color': t.marker?.color,
        'marker.line.color': t.marker?.line?.color,
        'error_y.color': t.error_y?.color,
        'line.color': t.line?.color,
    })) : [];

    // Apply grayscale trace colors
    const traceUpdates = {};
    if (plotDiv.data) {
        for (let i = 0; i < plotDiv.data.length; i++) {
            const gray = PRINT_GRAYS[i % PRINT_GRAYS.length];
            traceUpdates[i] = { 'marker.color': gray, 'marker.line.color': gray, 'line.color': gray };
            if (plotDiv.data[i].error_y) traceUpdates[i]['error_y.color'] = '#555';
        }
        for (const [idx, updates] of Object.entries(traceUpdates)) {
            await Plotly.restyle(plotDiv, updates, [parseInt(idx)]);
        }
    }

    // Apply white background + dark text layout
    await Plotly.relayout(plotDiv, {
        'paper_bgcolor': '#ffffff',
        'plot_bgcolor': '#ffffff',
        'font.color': '#222222',
        'title.font.color': '#222222',
        'xaxis.tickfont.color': '#222222',
        'xaxis.title.font.color': '#222222',
        'xaxis.gridcolor': '#ddd',
        'xaxis.linecolor': '#999',
        'yaxis.tickfont.color': '#222222',
        'yaxis.title.font.color': '#222222',
        'yaxis.gridcolor': '#ddd',
        'yaxis.linecolor': '#999',
        'legend.font.color': '#222222',
    });

    try {
        await exportFn();
    } finally {
        // Restore original trace colors
        if (plotDiv.data) {
            for (let i = 0; i < origData.length; i++) {
                const restore = {};
                if (origData[i]['marker.color'] !== undefined) restore['marker.color'] = origData[i]['marker.color'];
                if (origData[i]['marker.line.color'] !== undefined) restore['marker.line.color'] = origData[i]['marker.line.color'];
                if (origData[i]['error_y.color'] !== undefined) restore['error_y.color'] = origData[i]['error_y.color'];
                if (origData[i]['line.color'] !== undefined) restore['line.color'] = origData[i]['line.color'];
                if (Object.keys(restore).length > 0) await Plotly.restyle(plotDiv, restore, [i]);
            }
        }

        // Restore original layout
        await Plotly.relayout(plotDiv, {
            'paper_bgcolor': origLayout.paper_bgcolor || '#161616',
            'plot_bgcolor': origLayout.plot_bgcolor || '#161616',
            'font.color': origLayout.font?.color || '#e8e8e8',
            'title.font.color': origLayout.title?.font?.color || '#e8e8e8',
            'xaxis.tickfont.color': origLayout.xaxis?.tickfont?.color || '#e8e8e8',
            'xaxis.title.font.color': origLayout.xaxis?.title?.font?.color || '#e8e8e8',
            'xaxis.gridcolor': origLayout.xaxis?.gridcolor || '#2a2a2a',
            'xaxis.linecolor': origLayout.xaxis?.linecolor || '#2a2a2a',
            'yaxis.tickfont.color': origLayout.yaxis?.tickfont?.color || '#e8e8e8',
            'yaxis.title.font.color': origLayout.yaxis?.title?.font?.color || '#e8e8e8',
            'yaxis.gridcolor': origLayout.yaxis?.gridcolor || '#2a2a2a',
            'yaxis.linecolor': origLayout.yaxis?.linecolor || '#2a2a2a',
            'legend.font.color': origLayout.legend?.font?.color || '#e8e8e8',
        });
    }
}

// Export functions for plot downloads (print-friendly grayscale on white)
function exportPlotAsPNG(plotId) {
    const plotDiv = document.getElementById(plotId);
    if (!plotDiv) return;
    exportPlotWithPrintLayout(plotDiv, () =>
        Plotly.downloadImage(plotDiv, {
            format: 'png',
            width: 1920,
            height: 1080,
            filename: 'analysis_plot'
        })
    );
}

function exportPlotAsSVG(plotId) {
    const plotDiv = document.getElementById(plotId);
    if (!plotDiv) return;
    exportPlotWithPrintLayout(plotDiv, () =>
        Plotly.downloadImage(plotDiv, {
            format: 'svg',
            filename: 'analysis_plot'
        })
    );
}

async function exportPlotAsPDF(plotId, participant, displayName) {
    const plotDiv = document.getElementById(plotId);
    if (!plotDiv) return;
    const filename = `${participant}_${(displayName || 'plot').replace(/\s+/g, '_').replace(/\.parquet$/i, '')}`;

    await exportPlotWithPrintLayout(plotDiv, async () => {
        // Render to PNG first (Plotly PDF export is unreliable in many browsers)
        const dataUrl = await Plotly.toImage(plotDiv, { format: 'png', width: 1920, height: 1080 });
        const pngBytes = Uint8Array.from(atob(dataUrl.split(',')[1]), c => c.charCodeAt(0));

        // Wait for pdf-lib
        if (typeof PDFLib === 'undefined') {
            await new Promise(resolve => {
                const check = setInterval(() => { if (typeof PDFLib !== 'undefined') { clearInterval(check); resolve(); } }, 100);
            });
        }
        const { PDFDocument } = PDFLib;
        const pdfDoc = await PDFDocument.create();
        const pngImage = await pdfDoc.embedPng(pngBytes);
        const pageW = 842, pageH = 595; // A4 landscape
        const page = pdfDoc.addPage([pageW, pageH]);
        const margin = 30;
        const maxW = pageW - margin * 2, maxH = pageH - margin * 2;
        const scale = Math.min(maxW / pngImage.width, maxH / pngImage.height, 1);
        const drawW = pngImage.width * scale, drawH = pngImage.height * scale;
        const x = margin + (maxW - drawW) / 2;
        page.drawImage(pngImage, { x, y: pageH - margin - drawH, width: drawW, height: drawH });
        pdfDoc.setTitle(filename);
        pdfDoc.setCreator('Open Data - 5ha99y');
        const pdfBytes = await pdfDoc.save();
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename + '.pdf';
        a.click();
        URL.revokeObjectURL(a.href);
    });
}

// Initialize page: data is already loaded via window.plotsData
// Discover all repos with analysis results
// Check GitHub API rate limit and return remaining calls
async function checkRateLimit() {
    try {
        const response = await fetch('https://api.github.com/rate_limit');
        if (response.ok) {
            const data = await response.json();
            const core = data.rate || data.resources?.core;
            if (core) {
                const resetDate = new Date(core.reset * 1000);
                return { remaining: core.remaining, limit: core.limit, reset: resetDate };
            }
        }
    } catch (e) { /* ignore */ }
    return null;
}

// Fetch the full Git tree for a repo in a single API call (replaces multiple contents API calls)
async function fetchRepoTree(owner, repo) {
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/main?recursive=1`;
    try {
        const response = await fetch(apiUrl);
        if (!response.ok) {
            if (response.status === 403 || response.status === 429) {
                const rateInfo = await checkRateLimit();
                if (rateInfo && rateInfo.remaining === 0) {
                    throw new Error(`RATE_LIMIT:${rateInfo.reset.toISOString()}`);
                }
            }
            return null;
        }
        const data = await response.json();
        return data.tree || null; // Array of {path, type: 'blob'|'tree', size, ...}
    } catch (error) {
        if (error.message.startsWith('RATE_LIMIT:')) throw error;
        console.error('[Analysis] Error fetching tree for', repo, error);
        return null;
    }
}

async function discoverAnalysisRepos(username) {
    console.log('[Analysis] Discovering repos for user:', username);
    
    try {
        // Fetch all public repos for the user (1 API call)
        const reposUrl = `https://api.github.com/users/${username}/repos?per_page=100`;
        const response = await fetch(reposUrl);
        
        if (!response.ok) {
            if (response.status === 403 || response.status === 429) {
                const rateInfo = await checkRateLimit();
                if (rateInfo && rateInfo.remaining === 0) {
                    throw new Error(`RATE_LIMIT:${rateInfo.reset.toISOString()}`);
                }
            }
            throw new Error(`GitHub API error: ${response.status}`);
        }
        
        const repos = await response.json();
        console.log('[Analysis] Found', repos.length, 'total repos');
        
        const analysisRepos = [];
        
        // Fetch full tree for each repo (1 API call per repo instead of N)
        for (const repo of repos) {
            const tree = await fetchRepoTree(username, repo.name);
            if (!tree) continue;
            
            // Find all directories ending with _results
            const resultsDirs = new Set();
            for (const item of tree) {
                const parts = item.path.split('/');
                if (parts.length >= 1 && parts[0].endsWith('_results')) {
                    resultsDirs.add(parts[0]);
                }
            }
            
            if (resultsDirs.size > 0) {
                console.log('[Analysis] Found analysis repo:', repo.name, 'with folders:', [...resultsDirs]);
                
                for (const dir of resultsDirs) {
                    // Build a nested folder structure from all files under this results dir
                    const folders = {};
                    const escaped = dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const prefix = new RegExp(`^${escaped}/`);
                    for (const item of tree) {
                        if (item.type !== 'blob') continue;
                        if (!prefix.test(item.path)) continue;
                        // Get relative path within results dir
                        const relPath = item.path.replace(prefix, '');
                        const parts = relPath.split('/');
                        // Skip dotfiles and files inside dot-directories (e.g. .bin/)
                        if (parts.some(p => p.startsWith('.'))) continue;
                        const fileName = parts.pop();
                        const folderPath = parts.join('/');
                        if (!folders[folderPath]) folders[folderPath] = [];
                        folders[folderPath].push({
                            name: fileName,
                            path: item.path,
                            size: item.size || 0,
                            folderPath: folderPath,
                            url: `https://raw.githubusercontent.com/${username}/${repo.name}/main/${item.path}`
                        });
                    }
                    
                    analysisRepos.push({
                        owner: username,
                        name: repo.name,
                        description: repo.description || '',
                        resultsDir: dir,
                        folders: folders
                    });
                }
            }
        }
        
        console.log('[Analysis] Discovered', analysisRepos.length, 'analysis repos');
        return analysisRepos;
        
    } catch (error) {
        if (error.message.startsWith('RATE_LIMIT:')) throw error;
        console.error('[Analysis] Error discovering repos:', error);
        return [];
    }
}

// Build a proper tree structure from flat folder-path → files map
function buildFolderTree(folders) {
    const root = { children: {}, files: folders[''] || [] };
    for (const [folderPath, files] of Object.entries(folders)) {
        if (folderPath === '') continue;
        const parts = folderPath.split('/');
        let node = root;
        for (const part of parts) {
            if (!node.children[part]) node.children[part] = { children: {}, files: [] };
            node = node.children[part];
        }
        node.files = node.files.concat(files);
    }
    return root;
}

// Count all files recursively in a tree node
function countTreeFiles(node) {
    let count = node.files.length;
    for (const child of Object.values(node.children)) count += countTreeFiles(child);
    return count;
}

// Render a single file item in the sidebar tree
function renderFileItem(file) {
    if (!file.name.endsWith('.parquet')) return '';
    const sizeKB = (file.size / 1024).toFixed(1);
    const displayName = file.name.replace(/_/g, '_<wbr>').replace(/\./g, '<wbr>.');
    const folderLabel = (file.folderPath || '').replace(/'/g, "\\'");
    const isLog = /\.log\.parquet$/i.test(file.name);
    if (isLog) {
        return `
            <div class="tree-item" onclick="loadLogFile('${file.url}', '${file.name}', '${folderLabel}')" data-filename="${file.name.toLowerCase()}">
                📄 ${displayName}
                <span style="color: var(--text-muted, #999); font-size: 0.8em; margin-left: 5px;">(${sizeKB}KB)</span>
            </div>
        `;
    }
    return `
        <div class="tree-item" onclick="loadPlotFile('${file.url}', '${file.name}', '${folderLabel}')" data-filename="${file.name.toLowerCase()}">
            📊 ${displayName}
            <span style="color: var(--text-muted, #999); font-size: 0.8em; margin-left: 5px;">(${sizeKB}KB)</span>
        </div>
    `;
}

// Recursively render a tree node into sidebar HTML
function renderTreeNode(node) {
    let html = '';
    // Render files at this level
    node.files.forEach(file => { html += renderFileItem(file); });
    // Render child folders
    const childNames = Object.keys(node.children).sort();
    childNames.forEach(name => {
        const child = node.children[name];
        const count = countTreeFiles(child);
        html += `
            <div class="tree-folder" onclick="toggleFolder(this)" data-expanded="false">
                <span class="tree-folder-icon">▶</span>
                <span>${name}</span>
                <span style="color: var(--text-muted, #999); font-size: 0.85em; margin-left: 5px;">(${count})</span>
            </div>
            <div class="tree-folder-content" style="margin-left: 10px;">
        `;
        html += renderTreeNode(child);
        html += '</div>';
    });
    return html;
}

// Render file tree in sidebar
function renderFileTree(structure, append = false) {
    console.log('[Analysis] Rendering file tree for:', structure.repoName, 'append:', append);
    
    const fileTree = document.getElementById('file-tree');
    const { repoName, repoOwner, description, folders } = structure;
    
    // Store description for lookup by showRepoInfo
    window._repoDescriptions = window._repoDescriptions || {};
    window._repoDescriptions[repoOwner + '/' + repoName] = description || '';

    const tree = buildFolderTree(folders);
    const totalFiles = countTreeFiles(tree);

    // Build tree HTML
    let html = `
        <div class="tree-folder" onclick="toggleFolder(this)" data-expanded="false" data-repo-owner="${repoOwner}" data-repo-name="${repoName}">
            <span class="tree-folder-icon">▶</span>
            <span>${repoName}</span>
            <span style="color: var(--text-muted, #999); font-size: 0.85em; margin-left: 5px;">(${totalFiles})</span>
        </div>
        <div class="tree-folder-content" style="margin-left: 10px;">
    `;

    html += renderTreeNode(tree);

    // README as last item
    html += `
            <div class="tree-item" onclick="showRepoInfo('${repoOwner}', '${repoName}')" style="font-style: italic; color: var(--accent-primary, #c9a227); font-size: 0.82rem; cursor: pointer;">
                📖 README
            </div>
        </div>
    `;
    
    // Either replace or append
    if (append) {
        fileTree.innerHTML += html;
    } else {
        fileTree.innerHTML = html;
    }
    
    // Flatten all files for size lookup in loadPlotFile
    const allFiles = [];
    for (const files of Object.values(folders)) {
        allFiles.push(...files);
    }

    // Store globally for search and pipeline trace (extend if appending)
    if (!window.analysisData) {
        window.analysisData = { repos: [], allFiles: [] };
    }
    if (append) {
        window.analysisData.repos = window.analysisData.repos || [];
        window.analysisData.repos.push(structure);
        window.analysisData.allFiles = (window.analysisData.allFiles || []).concat(allFiles);
    } else {
        window.analysisData = { repos: [structure], allFiles: allFiles };
    }
    
    console.log('[Analysis] File tree rendered successfully');
}

// Render repos from discovery data (used by both fresh fetch and cache)
function loadReposFromData(analysisRepos, emptyState) {
    let loadedCount = 0;
    for (const repoConfig of analysisRepos) {
        const structure = {
            repoName: repoConfig.name,
            repoOwner: repoConfig.owner,
            description: repoConfig.description || '',
            resultsDir: repoConfig.resultsDir,
            folders: repoConfig.folders
        };
        
        const hasFiles = structure.folders && Object.values(structure.folders).some(f => f.length > 0);
        if (!hasFiles) continue;
        
        renderFileTree(structure, loadedCount > 0);
        
        if (loadedCount === 0) {
            emptyState.style.display = 'none';
        }
        
        // Pipeline trace uses raw.githubusercontent.com (not API, no rate limit)
        fetchPipelineTrace(`${structure.repoOwner}/${structure.repoName}`, structure.resultsDir);
        
        loadedCount++;
    }
    
    if (loadedCount === 0) {
        emptyState.innerHTML = `
            <h2>No Plot Data Found</h2>
            <p>Found ${analysisRepos.length} result folder(s) but none contain displayable files.</p>
        `;
    } else {
        const searchInput = document.getElementById('search-box');
        if (searchInput && !searchInput.hasAttribute('data-initialized')) {
            searchInput.setAttribute('data-initialized', 'true');
            searchInput.addEventListener('input', (e) => {
                filterFileTree(e.target.value);
            });
        }
    }
}

async function initAnalysisPage() {
    console.log('[Analysis] Initializing page - discovering repos...');
    
    const emptyState = document.getElementById('empty-state');
    const CACHE_KEY = 'analysis_repos_cache_v2';
    const CACHE_TTL = 10 * 60 * 1000; // 10 minutes
    
    // Try sessionStorage cache first to avoid unnecessary API calls
    try {
        const cached = sessionStorage.getItem(CACHE_KEY);
        if (cached) {
            const { data, timestamp } = JSON.parse(cached);
            if (Date.now() - timestamp < CACHE_TTL && data.length > 0) {
                console.log('[Analysis] Using cached discovery data (' + data.length + ' repos)');
                loadReposFromData(data, emptyState);
                return;
            }
        }
    } catch (e) { /* cache miss, proceed with API */ }
    
    // Show loading state
    emptyState.innerHTML = `
        <h2>Discovering Analysis Repositories...</h2>
        <p>Scanning GitHub for repositories with analysis results</p>
        <div class="spinner" style="width: 40px; height: 40px; border: 4px solid var(--border-primary, #ddd); border-top: 4px solid var(--accent-primary, #c9a227); border-radius: 50%; animation: spin 1s linear infinite; margin: 20px auto;"></div>
    `;
    
    try {
        // Fetch GitHub username from our own data
        const baseUrl = (window.SITE_BASE_URL || '').replace(/\/$/, '') + '/';
        let username = 'CGutt-hub';
        try {
            const githubDataResponse = await fetch(baseUrl + 'data/github.json');
            if (githubDataResponse.ok) {
                const githubData = await githubDataResponse.json();
                if (githubData.repos && githubData.repos[0]) {
                    username = githubData.repos[0].url.split('/')[3] || username;
                }
            }
        } catch (e) {
            console.warn('[Analysis] Could not load github.json, using fallback username');
        }
        
        console.log('[Analysis] GitHub username:', username);
        
        // Discover all repos with *_results folders (uses Git Trees API: 1 call per repo)
        const analysisRepos = await discoverAnalysisRepos(username);
        
        if (analysisRepos.length === 0) {
            // Check if rate limiting is the cause
            const rateInfo = await checkRateLimit();
            if (rateInfo && rateInfo.remaining === 0) {
                const resetMin = Math.ceil((rateInfo.reset - new Date()) / 60000);
                emptyState.innerHTML = `
                    <h2>GitHub API Rate Limit Reached</h2>
                    <p>The unauthenticated GitHub API allows 60 requests per hour.</p>
                    <p style="color: var(--text-secondary); margin-top: 10px;">Rate limit resets in <strong>${resetMin > 0 ? resetMin : '< 1'} minute(s)</strong> (at ${rateInfo.reset.toLocaleTimeString()}).</p>
                    <p style="color: var(--text-muted); font-size: 0.85em; margin-top: 15px;">Please wait and refresh the page afterward.</p>
                `;
            } else {
                emptyState.innerHTML = `
                    <h2>No Analysis Results Found</h2>
                    <p>No repositories with <code>*_results/*/plots/*.parquet</code> structure found for <strong>${username}</strong>.</p>
                    <p style="color: var(--text-muted); font-size: 0.85em; margin-top: 15px;">Check console for details or try refreshing.</p>
                `;
            }
            return;
        }
        
        console.log('[Analysis] Found', analysisRepos.length, 'analysis repos');
        
        // Cache successful discovery in sessionStorage
        try {
            sessionStorage.setItem(CACHE_KEY, JSON.stringify({ data: analysisRepos, timestamp: Date.now() }));
        } catch (e) { /* storage full or unavailable */ }
        
        loadReposFromData(analysisRepos, emptyState);
        
    } catch (error) {
        console.error('[Analysis] Error initializing page:', error);
        
        if (error.message.startsWith('RATE_LIMIT:')) {
            const resetDate = new Date(error.message.split(':').slice(1).join(':'));
            const resetMin = Math.ceil((resetDate - new Date()) / 60000);
            emptyState.innerHTML = `
                <h2>GitHub API Rate Limit Reached</h2>
                <p>The unauthenticated GitHub API allows 60 requests per hour.</p>
                <p style="color: var(--text-secondary); margin-top: 10px;">Rate limit resets in <strong>${resetMin > 0 ? resetMin : '< 1'} minute(s)</strong> (at ${resetDate.toLocaleTimeString()}).</p>
                <p style="color: var(--text-muted); font-size: 0.85em; margin-top: 15px;">Please wait and refresh the page afterward.</p>
            `;
        } else {
            emptyState.innerHTML = `
                <h2>Error Loading Data</h2>
                <p>Could not discover analysis repositories: ${error.message}</p>
                <p style="color: var(--text-secondary); font-size: 0.9em;">Check the console for details or try refreshing.</p>
            `;
        }
    }
}

// Start when page loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAnalysisPage);
} else {
    initAnalysisPage();
}

// Pipeline zoom/pan state and controls
var _pipelineState = { scale: 1, panX: 0, panY: 0 };
var _pipelineStateL2 = { scale: 1, panX: 0, panY: 0 };

function _getPipelineEls(level) {
    var suffix = level === 'l2' ? '-l2' : '';
    return {
        inner: document.getElementById('pipeline-zoom-inner' + suffix),
        container: document.getElementById('pipeline-zoom-container' + suffix),
        state: level === 'l2' ? _pipelineStateL2 : _pipelineState
    };
}

function _applyPipelineTransform(inner, state) {
    inner.style.transform = 'translate(' + state.panX + 'px,' + state.panY + 'px) scale(' + state.scale + ')';
}

function pipelineZoom(dir, level) {
    var els = _getPipelineEls(level);
    if (!els.inner) return;
    var s = els.state;
    if (dir === 0) { s.scale = 1; s.panX = 0; s.panY = 0; }
    else { s.scale = Math.min(5, Math.max(0.3, s.scale + dir * 0.25)); }
    _applyPipelineTransform(els.inner, s);
}

// Mouse-wheel zoom on pipeline containers
document.addEventListener('wheel', function(e) {
    var container = document.getElementById('pipeline-zoom-container');
    var containerL2 = document.getElementById('pipeline-zoom-container-l2');
    var level = null;
    if (container && container.contains(e.target)) level = 'l1';
    else if (containerL2 && containerL2.contains(e.target)) level = 'l2';
    if (!level) return;
    e.preventDefault();
    pipelineZoom(e.deltaY < 0 ? 1 : -1, level === 'l2' ? 'l2' : undefined);
}, { passive: false });

// Drag-to-pan on pipeline containers
(function() {
    var dragging = false, dragLevel = null, startX = 0, startY = 0, startPanX = 0, startPanY = 0;

    document.addEventListener('mousedown', function(e) {
        if (e.button !== 0) return;
        var container = document.getElementById('pipeline-zoom-container');
        var containerL2 = document.getElementById('pipeline-zoom-container-l2');
        var level = null;
        if (container && container.contains(e.target)) level = 'l1';
        else if (containerL2 && containerL2.contains(e.target)) level = 'l2';
        if (!level) return;
        dragging = true;
        dragLevel = level === 'l2' ? 'l2' : undefined;
        var s = _getPipelineEls(dragLevel).state;
        startX = e.clientX; startY = e.clientY;
        startPanX = s.panX; startPanY = s.panY;
        e.preventDefault();
    });

    document.addEventListener('mousemove', function(e) {
        if (!dragging) return;
        var els = _getPipelineEls(dragLevel);
        if (!els.inner) return;
        var s = els.state;
        s.panX = startPanX + (e.clientX - startX);
        s.panY = startPanY + (e.clientY - startY);
        _applyPipelineTransform(els.inner, s);
    });

    document.addEventListener('mouseup', function() {
        dragging = false;
    });
})();

// Toggle project info panel and lazy-load README
function showRepoInfo(owner, repoName) {
    var description = (window._repoDescriptions || {})[owner + '/' + repoName] || '';
    var plotDisplays = document.getElementById('plot-displays');
    var emptyState = document.getElementById('empty-state');
    if (emptyState) emptyState.style.display = 'none';

    // Generate pipeline tree HTML if available — resolve correct repo
    var repoPath = owner + '/' + repoName;
    var pipelineForRepo = (window.pipelineDataMap && window.pipelineDataMap[repoPath]) || window.pipelineData;
    var pipelineHTML = pipelineForRepo
        ? generatePipelineTreeHTML(repoName, pipelineForRepo)
        : '';
    var divider = '<hr style="border: none; border-top: 1px solid var(--border-primary, #2a2a2a); margin: 25px 0;">';

    plotDisplays.innerHTML = `
        <div class="plot-display active" id="current-plot">
            <div style="margin-bottom: 20px;">
                <div style="font-size: 1.1rem; font-weight: 600; color: var(--text-primary, #e8e8e8); margin-bottom: 4px;">${repoName}</div>
                ${description ? '<div style="font-size: 0.9rem; color: var(--text-secondary, #aaa); margin-bottom: 16px;">' + description.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</div>' : ''}
            </div>
            <div id="repo-readme" style="padding: 20px; background: var(--bg-secondary, #161616); border: 1px solid var(--border-primary, #2a2a2a); border-radius: 8px; min-height: 200px; max-height: calc(100vh - 280px); overflow-y: auto; line-height: 1.6; font-size: 0.9rem; color: var(--text-primary, #e8e8e8);">
                <div style="display: flex; align-items: center; justify-content: center; height: 120px; flex-direction: column; gap: 10px;">
                    <div class="spinner" style="width: 30px; height: 30px; border: 3px solid var(--bg-tertiary, #ddd); border-top: 3px solid var(--accent-primary, #c9a227); border-radius: 50%; animation: spin 1s linear infinite;"></div>
                    <p style="color: var(--text-muted, #999); font-size: 0.85rem;">Loading README...</p>
                </div>
            </div>
            ${pipelineHTML ? divider + pipelineHTML : ''}
        </div>
    `;

    var readmeEl = document.getElementById('repo-readme');
    fetch('https://raw.githubusercontent.com/' + owner + '/' + repoName + '/main/README.md')
        .then(function(r) { return r.ok ? r.text() : null; })
        .then(function(text) {
            if (!text) { readmeEl.innerHTML = '<p style="color: var(--text-muted, #999);">No README available.</p>'; return; }
            readmeEl.innerHTML = '<div class="rendered-markdown">' + marked.parse(text) + '</div>';
        })
        .catch(function() { readmeEl.innerHTML = '<p style="color: var(--text-muted, #999);">Could not load README.</p>'; });
}

// Load and display a log file in the main content area with level filtering
async function loadLogFile(url, displayName, participant) {
    const emptyState = document.getElementById('empty-state');
    const plotDisplays = document.getElementById('plot-displays');
    if (!emptyState || !plotDisplays) return;

    // Remove previous active states and mark clicked item
    document.querySelectorAll('.tree-item.active').forEach(item => item.classList.remove('active'));
    if (event && event.target) {
        const item = event.target.closest('.tree-item');
        if (item) item.classList.add('active');
    }
    emptyState.style.display = 'none';

    // Scroll the main area to top so the log header is visible
    const mainArea = document.querySelector('.analysis-main');
    if (mainArea) mainArea.scrollTop = 0;

    plotDisplays.innerHTML = `
        <div class="plot-display active" id="current-plot" style="display: flex; flex-direction: column; height: calc(100vh - 220px);">
            <div style="margin-bottom: 12px; flex-shrink: 0;">
                <div style="font-size: 0.85rem; font-weight: 600; color: var(--text-primary, #e8e8e8); margin-bottom: 4px;">Log: ${displayName}</div>
                <div style="font-size: 0.8rem; color: var(--text-secondary, #aaa); margin-bottom: 12px;">Participant: ${participant} <span id="log-line-count" style="margin-left: 16px; color: var(--text-muted, #666);"></span></div>
                <div style="display: flex; gap: 8px; margin-bottom: 12px;">
                    <button id="log-filter-all" onclick="filterLog('all')" style="padding: 4px 12px; border-radius: 4px; border: 1px solid var(--border-primary, #2a2a2a); background: var(--accent-primary, #c9a227); color: var(--bg-primary, #0f0f0f); font-size: 0.8rem; cursor: pointer; font-weight: 600;">All</button>
                    <button id="log-filter-warn" onclick="filterLog('warn')" style="padding: 4px 12px; border-radius: 4px; border: 1px solid var(--border-primary, #2a2a2a); background: var(--bg-secondary, #161616); color: var(--text-primary, #e8e8e8); font-size: 0.8rem; cursor: pointer;">⚠ Warnings</button>
                    <button id="log-filter-error" onclick="filterLog('error')" style="padding: 4px 12px; border-radius: 4px; border: 1px solid var(--border-primary, #2a2a2a); background: var(--bg-secondary, #161616); color: var(--text-primary, #e8e8e8); font-size: 0.8rem; cursor: pointer;">✖ Errors</button>
                </div>
            </div>
            <div id="log-content" style="padding: 16px; background: var(--bg-secondary, #161616); border: 1px solid var(--border-primary, #2a2a2a); border-radius: 8px; flex: 1; min-height: 0; overflow-y: auto; font-family: monospace; font-size: 0.8rem; line-height: 1.5; white-space: pre-wrap; word-break: break-all; color: var(--text-primary, #e8e8e8);">
                <div style="display: flex; align-items: center; justify-content: center; height: 120px; flex-direction: column; gap: 10px;">
                    <div class="spinner" style="width: 30px; height: 30px; border: 3px solid var(--bg-tertiary, #ddd); border-top: 3px solid var(--accent-primary, #c9a227); border-radius: 50%; animation: spin 1s linear infinite;"></div>
                    <p style="color: var(--text-muted, #999); font-size: 0.85rem;">Loading log file...</p>
                </div>
            </div>
        </div>
    `;

    try {
        await waitForHyparquet();
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status} fetching log ${url}`);
        const arrayBuffer = await response.arrayBuffer();
        
        const rows = await window.hyparquetReadObjects({ file: arrayBuffer });
        // Extract text: join all string values from all rows
        let text = '';
        if (rows.length > 0) {
            const cols = Object.keys(rows[0]);
            console.log('[Log] Rows:', rows.length, 'Columns:', cols);
            // Find the column most likely containing log text
            const textCol = cols.find(c => /log|text|message|content|output/i.test(c)) || cols[0];
            console.log('[Log] Using column:', textCol);
            // Each row's value may itself contain newlines (e.g. entire log in one cell)
            const parts = [];
            for (const r of rows) {
                const val = r[textCol];
                if (val != null) parts.push(String(val));
            }
            text = parts.join('\n');
            console.log('[Log] Total text length:', text.length, 'chars');
        }
        window._logLines = text.split('\n');
        console.log('[Log] Total lines after split:', window._logLines.length);
        window._logFilter = 'all';
        renderLogLines('all');
    } catch (e) {
        console.error('[Analysis] Error loading log parquet:', e);
        document.getElementById('log-content').innerHTML = '<span style="color: var(--text-muted, #999);">Could not load log file.</span>';
    }
}

function filterLog(level) {
    window._logFilter = level;
    // Update button styles
    ['all', 'warn', 'error'].forEach(function(l) {
        var btn = document.getElementById('log-filter-' + l);
        if (!btn) return;
        if (l === level) {
            btn.style.background = 'var(--accent-primary, #c9a227)';
            btn.style.color = 'var(--bg-primary, #0f0f0f)';
            btn.style.fontWeight = '600';
        } else {
            btn.style.background = 'var(--bg-secondary, #161616)';
            btn.style.color = 'var(--text-primary, #e8e8e8)';
            btn.style.fontWeight = 'normal';
        }
    });
    renderLogLines(level);
}

function renderLogLines(level) {
    var lines = window._logLines || [];
    var el = document.getElementById('log-content');
    if (!el) return;
    var filtered;
    if (level === 'warn') {
        filtered = lines.filter(function(l) { return /warn|warning/i.test(l); });
    } else if (level === 'error') {
        filtered = lines.filter(function(l) { return /error|exception|fatal|critical/i.test(l); });
    } else {
        filtered = lines;
    }
    if (filtered.length === 0) {
        el.innerHTML = '<span style="color: var(--text-muted, #999);">No ' + (level === 'all' ? '' : level + ' ') + 'entries found.</span>';
        return;
    }
    // Show line count
    var countEl = document.getElementById('log-line-count');
    if (countEl) {
        countEl.textContent = filtered.length + ' / ' + lines.length + ' lines';
    }
    // Colorize lines
    var html = filtered.map(function(line) {
        var escaped = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        if (/error|exception|fatal|critical/i.test(line)) {
            return '<span style="color: #ff6b6b;">' + escaped + '</span>';
        } else if (/warn|warning/i.test(line)) {
            return '<span style="color: #ffd93d;">' + escaped + '</span>';
        }
        return escaped;
    }).join('\n');
    el.innerHTML = html;
    // Reset scroll after layout to ensure we start at the top
    requestAnimationFrame(function() {
        el.scrollTop = 0;
        var mainArea = document.querySelector('.analysis-main');
        if (mainArea) mainArea.scrollTop = 0;
    });
}

// Expose functions to global scope for inline onclick handlers
window.loadPlotFile = loadPlotFile;
window.toggleFolder = toggleFolder;
window.showRepoInfo = showRepoInfo;
window.loadLogFile = loadLogFile;
window.filterLog = filterLog;
window.exportPlotAsPNG = exportPlotAsPNG;
window.exportPlotAsSVG = exportPlotAsSVG;
window.exportPlotAsPDF = exportPlotAsPDF;
window.pipelineZoom = pipelineZoom;

// Re-apply Plotly colors when theme changes (light/dark toggle)
new MutationObserver(() => {
    const chartDiv = document.getElementById('current-plot-chart');
    if (!chartDiv || !chartDiv.data || !chartDiv.data.length) return;
    const cs = getComputedStyle(document.documentElement);
    const bg = cs.getPropertyValue('--bg-secondary').trim() || '#161616';
    const txt = cs.getPropertyValue('--text-primary').trim() || '#e8e8e8';
    const grid = cs.getPropertyValue('--border-primary').trim() || '#2a2a2a';
    Plotly.relayout(chartDiv, {
        'paper_bgcolor': bg, 'plot_bgcolor': bg,
        'font.color': txt, 'title.font.color': txt,
        'xaxis.tickfont.color': txt, 'xaxis.title.font.color': txt,
        'xaxis.gridcolor': grid, 'xaxis.linecolor': grid,
        'yaxis.tickfont.color': txt, 'yaxis.title.font.color': txt,
        'yaxis.gridcolor': grid, 'yaxis.linecolor': grid,
        'legend.font.color': txt,
    });
}).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
