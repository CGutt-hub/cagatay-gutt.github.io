// Open Data Analysis Page JavaScript
// Fetches and renders parquet files directly from GitHub repos

// Check if parquet library is available on page load
console.log('[Analysis] Script loaded. Parquet library status:', typeof parquet !== 'undefined' ? 'Available' : 'Not yet loaded');

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

// Fetch and parse parquet file from GitHub repo
// Supports two call signatures:
//   fetchParquetData(repoName, filePath) - legacy format
//   fetchParquetData(url, fileSize) - when url is provided directly with optional file size
async function fetchParquetData(repoNameOrUrl, filePathOrSize = null) {
    console.log('[Analysis] fetchParquetData called:', { repoNameOrUrl, filePathOrSize });
    
    try {
        // Construct raw GitHub URL
        const url = typeof filePathOrSize === 'string'
            ? `https://raw.githubusercontent.com/CGutt-hub/${repoNameOrUrl}/main/${filePathOrSize}`
            : repoNameOrUrl;
        
        const fileSize = typeof filePathOrSize === 'number' ? filePathOrSize : 0;
        
        console.log('[Analysis] Will fetch from URL:', url);
        console.log('[Analysis] File size estimate:', fileSize, 'bytes');
        
        // Check available memory (if supported)
        if (performance && performance.memory) {
            const memoryInfo = performance.memory;
            const usedMemoryMB = memoryInfo.usedJSHeapSize / (1024 * 1024);
            const limitMemoryMB = memoryInfo.jsHeapSizeLimit / (1024 * 1024);
            const availableMemoryMB = limitMemoryMB - usedMemoryMB;
            const fileSizeMB = fileSize / (1024 * 1024);
            
            console.log(`[Analysis] Memory check: ${usedMemoryMB.toFixed(0)}MB used, ${availableMemoryMB.toFixed(0)}MB available, file is ${fileSizeMB.toFixed(1)}MB`);
            
            // Warn if file is more than 50% of available memory
            if (fileSizeMB > availableMemoryMB * 0.5) {
                console.warn('[Analysis] Large file relative to available memory - may cause performance issues');
            }
        }
        
        console.log('[Analysis] Fetching:', url);
        
        // Fetch the file with timeout for large files
        const controller = new AbortController();
        const timeoutDuration = fileSize > 50 * 1024 * 1024 ? 120000 : 60000; // 2min for large files, 1min otherwise
        const timeoutId = setTimeout(() => controller.abort(), timeoutDuration);
        
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const contentLength = response.headers.get('content-length');
        if (contentLength) {
            console.log(`[Analysis] File size: ${(parseInt(contentLength) / 1024 / 1024).toFixed(2)} MB`);
        }
        
        const arrayBuffer = await response.arrayBuffer();
        console.log(`[Analysis] Downloaded ${(arrayBuffer.byteLength / 1024 / 1024).toFixed(2)} MB`);
        
        // Wait for parquet library to load
        if (typeof parquet === 'undefined') {
            console.log('[Analysis] Parquet library not loaded yet, waiting...');
            await new Promise(resolve => {
                const checkInterval = setInterval(() => {
                    if (typeof parquet !== 'undefined') {
                        console.log('[Analysis] Parquet library loaded successfully');
                        clearInterval(checkInterval);
                        resolve();
                    }
                }, 100);
                setTimeout(() => {
                    clearInterval(checkInterval);
                    console.warn('[Analysis] Parquet library loading timeout after 10s');
                    resolve();
                }, 10000); // Increased timeout to 10s for slow connections
            });
        }
        
        // Check if parquet library is available
        if (typeof parquet === 'undefined') {
            throw new Error('Parquet library failed to load. Please check your internet connection and try refreshing the page.');
        }
        
        // Parse parquet file
        console.log('[Analysis] Parsing parquet file with parquet.ParquetReader');
        const parseStartTime = Date.now();
        const reader = await parquet.ParquetReader.openBuffer(new Uint8Array(arrayBuffer));
        const cursor = reader.getCursor();
        const rows = [];
        let record = null;
        let rowCount = 0;
        
        // Read rows with periodic progress logging for large files
        while (record = await cursor.next()) {
            rows.push(record);
            rowCount++;
            
            // Log progress every 10000 rows for large files
            if (rowCount % 10000 === 0 && fileSize > 10 * 1024 * 1024) {
                console.log(`[Analysis] Parsed ${rowCount} rows...`);
            }
        }
        
        await reader.close();
        
        const parseTime = ((Date.now() - parseStartTime) / 1000).toFixed(1);
        console.log(`[Analysis] Parsed ${rowCount} rows in ${parseTime}s`);
        
        return { rows, arrayBuffer };
    } catch (error) {
        if (error.name === 'AbortError') {
            throw new Error('Download timeout - file is too large or connection too slow. Please try again or use a smaller file.');
        }
        console.error('Error fetching/parsing parquet:', error);
        throw error;
    }
}

// Convert parquet data to Plotly format
// Supports two call signatures:
//   parquetToPlotly(rows) - when rows are already parsed
//   parquetToPlotly(arrayBuffer, title) - when arrayBuffer needs parsing
async function parquetToPlotly(rowsOrBuffer, title = null) {
    let rows;
    
    // Handle arrayBuffer input (parse it first)
    if (rowsOrBuffer instanceof ArrayBuffer || ArrayBuffer.isView(rowsOrBuffer)) {
        if (typeof parquet === 'undefined') {
            throw new Error('Parquet library not loaded yet');
        }
        const reader = await parquet.ParquetReader.openBuffer(new Uint8Array(rowsOrBuffer));
        const cursor = reader.getCursor();
        rows = [];
        let record = null;
        while (record = await cursor.next()) {
            rows.push(record);
        }
        await reader.close();
    } else {
        rows = rowsOrBuffer;
    }
    
    if (!rows || rows.length === 0) {
        return null;
    }
    
    // Detect column types  
    const firstRow = rows[0];
    const columns = Object.keys(firstRow);
    
    // Simple heuristic: if we have x/y or time/value columns, create line plot
    const xCol = columns.find(c => c.toLowerCase().match(/^(x|time|timestamp|index)$/)) || columns[0];
    const yCol = columns.find(c => c.toLowerCase().match(/^(y|value|signal|data)$/)) || columns[1];
    
    if (!yCol) {
        return null;
    }
    
    // Extract x and y data
    const xData = rows.map(r => r[xCol]);
    const yData = rows.map(r => r[yCol]);
    
    const trace = {
        x: xData,
        y: yData,
        type: 'scatter',
        mode: 'lines+markers',
        name: yCol,
        marker: { size: 4 }
    };
    
    const layout = {
        title: title || `${yCol} vs ${xCol}`,
        xaxis: { title: xCol },
        yaxis: { title: yCol },
        hovermode: 'closest'
    };
    
    return { data: [trace], layout };
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
            const participant = pathParts[1];
            const filename = pathParts[pathParts.length - 1];
            
            return {
                path: item.file_path,
                url: `https://raw.githubusercontent.com/${repoPath}/main/${item.file_path}`,
                participant: participant,
                filename: filename,
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
        
        // Fetch and display pipeline structure
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
            // Simple markdown-to-HTML (basic support for common patterns)
            let htmlContent = plotItem.readme
                .replace(/^### (.+)$/gm, '<h4>$1</h4>')
                .replace(/^## (.+)$/gm, '<h3>$1</h3>')
                .replace(/^# (.+)$/gm, '<h2>$1</h2>')
                .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                .replace(/\*(.+?)\*/g, '<em>$1</em>')
                .replace(/`(.+?)`/g, '<code>$1</code>')
                .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank">$1</a>')
                .replace(/\n\n/g, '</p><p>')
                .replace(/^(.+)$/gm, '<p>$1</p>');
            readmeContent.innerHTML = htmlContent;
            
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
            // Store globally so it can be used when displaying plots
            window.pipelineData = pipeline;
            console.log('[Pipeline] Loaded pipeline with', pipeline.processes.length, 'modules');
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
        return { name, displayName: dn, count: data.count, failed: data.failed };
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

// Download pipeline SVG
function downloadPipelineSVG() {
    const svg = document.getElementById('pipeline-dag-svg');
    if (!svg) return;
    const clone = svg.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'pipeline.svg';
    a.click();
    URL.revokeObjectURL(a.href);
}

// Download pipeline as greyscale PNG (2x resolution for print)
function downloadPipelinePNG() {
    const svg = document.getElementById('pipeline-dag-svg');
    if (!svg) return;
    const clone = svg.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
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

// Generate SVG-based DAG pipeline tree
function generatePipelineTreeHTML(filename, pipelineData) {
    if (!pipelineData || !pipelineData.processes || pipelineData.processes.length === 0) return '';

    const { processes, edges } = pipelineData;
    const lowerFilename = filename.toLowerCase();

    // Identify producer module
    let producerModule = null;
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

    // Build adjacency for layer assignment
    const nameSet = new Set(processes.map(p => p.name));
    const parentsOf = new Map();
    for (const p of processes) parentsOf.set(p.name, []);
    for (const e of edges) {
        if (nameSet.has(e.from) && nameSet.has(e.to)) parentsOf.get(e.to).push(e.from);
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

    // Node dimensions
    const nodeH = 24;
    const hGap = 14;
    const vGap = 42;
    const padX = 16;
    const padY = 16;
    const nodeWidths = new Map();
    for (const p of processes) {
        const label = p.count > 1 ? p.displayName + ' x' + p.count : p.displayName;
        nodeWidths.set(p.name, Math.max(64, label.length * 5.8 + 18));
    }

    // Position nodes, center each layer
    const positions = new Map();
    let maxLayerW = 0;
    const layerWidths = new Map();
    for (const li of sortedLayers) {
        const nodes = layerGroups.get(li);
        let totalW = 0;
        for (const p of nodes) totalW += nodeWidths.get(p.name);
        totalW += (nodes.length - 1) * hGap;
        layerWidths.set(li, totalW);
        if (totalW > maxLayerW) maxLayerW = totalW;
    }
    const svgW = maxLayerW + padX * 2;
    for (const li of sortedLayers) {
        const nodes = layerGroups.get(li);
        const y = padY + li * (nodeH + vGap);
        let x = padX + (maxLayerW - layerWidths.get(li)) / 2;
        for (const p of nodes) {
            const w = nodeWidths.get(p.name);
            positions.set(p.name, { x, y, w, h: nodeH });
            x += w + hGap;
        }
    }
    const svgH = padY * 2 + sortedLayers.length * (nodeH + vGap) - vGap;

    // Build SVG
    let svg = '';
    svg += '<svg id="pipeline-dag-svg" xmlns="http://www.w3.org/2000/svg" ';
    svg += 'width="' + svgW + '" height="' + svgH + '" ';
    svg += 'viewBox="0 0 ' + svgW + ' ' + svgH + '" ';
    svg += "style=\"font-family:'Segoe UI',Helvetica,Arial,sans-serif;\">";
    svg += '<rect width="' + svgW + '" height="' + svgH + '" fill="#fff"/>';
    svg += '<defs><marker id="dag-arrow" viewBox="0 0 10 8" refX="10" refY="4" markerWidth="7" markerHeight="6" orient="auto">';
    svg += '<path d="M0,0 L10,4 L0,8 z" fill="#999"/></marker></defs>';

    // Edges
    for (const e of edges) {
        const from = positions.get(e.from);
        const to = positions.get(e.to);
        if (!from || !to) continue;
        const x1 = from.x + from.w / 2, y1 = from.y + from.h;
        const x2 = to.x + to.w / 2, y2 = to.y;
        const cy1 = y1 + (y2 - y1) * 0.4, cy2 = y1 + (y2 - y1) * 0.6;
        svg += '<path d="M' + x1 + ',' + y1 + ' C' + x1 + ',' + cy1 + ' ' + x2 + ',' + cy2 + ' ' + x2 + ',' + y2 + '" fill="none" stroke="#bbb" stroke-width="1" marker-end="url(#dag-arrow)"/>';
    }

    // Nodes
    for (const p of processes) {
        const pos = positions.get(p.name);
        if (!pos) continue;
        const isProd = p.name === producerModule;
        const fill = isProd ? '#ddd' : '#f7f7f7';
        const stroke = isProd ? '#333' : '#aaa';
        const sw = isProd ? '1.8' : '0.8';
        const fw = isProd ? 'bold' : 'normal';
        const label = p.count > 1 ? p.displayName + ' x' + p.count : p.displayName;
        svg += '<rect x="' + pos.x + '" y="' + pos.y + '" width="' + pos.w + '" height="' + pos.h + '" rx="3" ry="3" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + sw + '"/>';
        svg += '<text x="' + (pos.x + pos.w / 2) + '" y="' + (pos.y + pos.h / 2 + 3.5) + '" text-anchor="middle" font-size="9" font-weight="' + fw + '" fill="#333">' + label + '</text>';
        if (p.failed) {
            svg += '<line x1="' + pos.x + '" y1="' + pos.y + '" x2="' + (pos.x + pos.w) + '" y2="' + (pos.y + pos.h) + '" stroke="#c00" stroke-width="1" opacity="0.5"/>';
        }
    }
    svg += '</svg>';

    return '<div style="margin-bottom: 15px; padding: 15px; background: var(--bg-tertiary, #f5f5f5); border-radius: 8px; border: 1px solid var(--border-primary, #ddd);">'
        + '<div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;">'
        + '<h4 style="margin: 0; font-size: 0.9rem; color: var(--text-primary, #333); font-weight: 600;">Processing Pipeline</h4>'
        + '<div style="display: flex; gap: 6px; align-items: center;">'
        + '<span style="font-size: 0.7rem; color: var(--text-muted, #999);">' + processes.length + ' modules, ' + edges.length + ' connections</span>'
        + '<div class="export-bar" style="margin-bottom:0; gap:6px;">'
        + '<button class="export-btn svg" onclick="downloadPipelineSVG()">&#8659; SVG</button>'
        + '<button class="export-btn png" onclick="downloadPipelinePNG()">&#8659; PNG</button>'
        + '</div></div></div>'
        + '<div style="overflow-x: auto; overflow-y: auto; max-height: 500px;">' + svg + '</div>'
        + '<div style="margin-top: 8px; font-size: 0.7rem; color: var(--text-muted, #999);">'
        + '<span style="display: inline-block; width: 14px; height: 10px; background: #ddd; border: 1.8px solid #333; border-radius: 2px; vertical-align: middle; margin-right: 4px;"></span>'
        + 'Highlighted: module likely produced this file'
        + '</div></div>';
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
    
    const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(2);
    const isLargeFile = fileSize > 10 * 1024 * 1024; // > 10MB
    const isVeryLargeFile = fileSize > 50 * 1024 * 1024; // > 50MB
    
    // Hide empty state
    emptyState.style.display = 'none';
    
    // Create plot display with size warning
    let sizeWarning = '';
    if (isVeryLargeFile) {
        sizeWarning = `
            <div style="background: #fff3cd; border: 1px solid #ffc107; border-radius: 5px; padding: 10px; margin-bottom: 15px; font-size: 0.85rem;">
                <strong>Large File Warning:</strong> This file is ${fileSizeMB} MB. Loading may take 1-2 minutes and requires significant memory.
                <br><span style="font-size: 0.8rem; color: #856404;">Data files are highly compressed but may still be large. Please be patient.</span>
            </div>
        `;
    } else if (isLargeFile) {
        sizeWarning = `
            <div style="background: #d1ecf1; border: 1px solid #17a2b8; border-radius: 5px; padding: 8px; margin-bottom: 12px; font-size: 0.8rem;">
                <strong>Info:</strong> This file is ${fileSizeMB} MB and may take 10-30 seconds to load.
            </div>
        `;
    }
    
    // Generate pipeline tree HTML if available
    const pipelineHTML = window.pipelineData 
        ? generatePipelineTreeHTML(displayName, window.pipelineData)
        : '';
    
    // Create plot display
    plotDisplays.innerHTML = `
        <div class="plot-display active" id="current-plot">
            ${pipelineHTML}
            <div style="margin-bottom: 20px; padding-top: 15px; border-top: 2px solid var(--border-primary, #ddd);">
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
                        Preparing... (${fileSizeMB} MB)
                    </span>
                </div>
            </div>
            <div id="current-plot-chart" style="width: 100%; height: calc(100vh - 300px); min-height: 500px;background: var(--bg-secondary, #f8f8f8); border: 1px solid var(--border-primary, #ddd); border-radius: 8px; overflow: hidden;">
                <div style="display: flex; align-items: center; justify-content: center; height: 100%; flex-direction: column; gap: 15px;">
                    <div class="spinner" style="width: 50px; height: 50px; border: 5px solid var(--bg-tertiary, #ddd); border-top: 5px solid var(--accent-primary, #c9a227); border-radius: 50%; animation: spin 1s linear infinite;"></div>
                    <p id="load-progress" style="color: var(--text-secondary, #666); font-size: 0.95rem;">Fetching ${fileSizeMB} MB file from GitHub...</p>
                    <p style="color: var(--text-muted, #999); font-size: 0.8rem;">Large files may take a moment to load</p>
                </div>
            </div>
        </div>
    `;
    
    console.log('[Analysis] Plot display created, starting data fetch...');
    
    try {
        const startTime = Date.now();
        
        console.log('[Analysis] Entering try block, calling fetchParquetData...');
        
        // Update progress: downloading
        const progressEl = document.getElementById('load-progress');
        if (progressEl) progressEl.textContent = `Downloading ${fileSizeMB} MB...`;
        
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
            statusSpan.textContent = `Loaded in ${totalTime}s (${fileSizeMB} MB)`;
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
        
        if (error.message.includes('Parquet library failed')) {
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
                ${fileSize > 10 * 1024 * 1024 ? `<p style="color: var(--text-muted, #999); font-size: 0.8rem; margin-top: 10px;">File size: ${fileSizeMB} MB</p>` : ''}
            </div>
        `;
    }
}

// Export functions for plot downloads
function exportPlotAsPNG(plotId) {
    const plotDiv = document.getElementById(plotId);
    if (plotDiv) {
        Plotly.downloadImage(plotDiv, {
            format: 'png',
            width: 1920,
            height: 1080,
            filename: 'analysis_plot'
        });
    }
}

function exportPlotAsSVG(plotId) {
    const plotDiv = document.getElementById(plotId);
    if (plotDiv) {
        Plotly.downloadImage(plotDiv, {
            format: 'svg',
            filename: 'analysis_plot'
        });
    }
}

function exportPlotAsPDF(plotId, participant, displayName) {
    const plotDiv = document.getElementById(plotId);
    if (plotDiv) {
        const filename = `${participant}_${displayName.replace(/\s+/g, '_')}`;
        Plotly.downloadImage(plotDiv, {
            format: 'pdf',
            width: 1920,
            height: 1080,
            filename: filename
        });
    }
}

// Initialize page: data is already loaded via window.plotsData
// Discover all repos with analysis results
async function discoverAnalysisRepos(username) {
    console.log('[Analysis] Discovering repos for user:', username);
    
    try {
        // Fetch all public repos for the user
        const reposUrl = `https://api.github.com/users/${username}/repos?per_page=100`;
        const response = await fetch(reposUrl);
        
        if (!response.ok) {
            throw new Error(`GitHub API error: ${response.status}`);
        }
        
        const repos = await response.json();
        console.log('[Analysis] Found', repos.length, 'total repos');
        
        const analysisRepos = [];
        
        // Check each repo for *_results folders
        for (const repo of repos) {
            const contents = await fetchRepoStructure(username, repo.name, '');
            
            if (!contents) continue;
            
            // Look for folders ending with _results
            const resultsFolders = contents.filter(item => 
                item.type === 'dir' && 
                item.name.endsWith('_results')
            );
            
            if (resultsFolders.length > 0) {
                console.log('[Analysis] Found analysis repo:', repo.name, 'with folders:', resultsFolders.map(f => f.name));
                
                // Add each results folder
                for (const folder of resultsFolders) {
                    analysisRepos.push({
                        owner: username,
                        name: repo.name,
                        resultsDir: folder.name
                    });
                }
            }
        }
        
        console.log('[Analysis] Discovered', analysisRepos.length, 'analysis repos');
        return analysisRepos;
        
    } catch (error) {
        console.error('[Analysis] Error discovering repos:', error);
        return [];
    }
}

// Fetch repository structure from GitHub API
async function fetchRepoStructure(owner, repo, path) {
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
    console.log('[Analysis] Fetching repo structure:', apiUrl);
    
    try {
        const response = await fetch(apiUrl);
        if (!response.ok) {
            throw new Error(`GitHub API error: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error('[Analysis] Error fetching repo structure:', error);
        return null;
    }
}

// Build file tree structure from GitHub repo
async function buildTreeFromRepo(repoConfig) {
    console.log('[Analysis] Building tree for:', repoConfig.name);
    
    const { owner, name, resultsDir } = repoConfig;
    const contents = await fetchRepoStructure(owner, name, resultsDir);
    
    if (!contents) {
        console.error('[Analysis] Could not fetch contents for', name);
        return null;
    }
    
    // Filter for participant folders (directories)
    const participantFolders = contents.filter(item => 
        item.type === 'dir' && 
        !item.name.startsWith('.') && 
        item.name !== 'scripts' &&
        item.name !== 'docs'
    );
    
    console.log('[Analysis] Found participant folders:', participantFolders.map(f => f.name));
    
    // Build structure
    const structure = {
        repoName: name,
        repoOwner: owner,
        resultsDir: resultsDir,
        participants: {}
    };
    
    // Fetch files for each participant
    for (const folder of participantFolders) {
        const participantPath = `${resultsDir}/${folder.name}/plots`;
        const files = await fetchRepoStructure(owner, name, participantPath);
        
        if (files && Array.isArray(files)) {
            const parquetFiles = files
                .filter(f => f.type === 'file' && f.name.endsWith('.parquet'))
                .map(f => ({
                    name: f.name,
                    path: f.path,
                    size: f.size,
                    url: `https://raw.githubusercontent.com/${owner}/${name}/main/${f.path}`
                }));
            
            structure.participants[folder.name] = parquetFiles;
        }
    }
    
    return structure;
}

// Render file tree in sidebar
function renderFileTree(structure, append = false) {
    console.log('[Analysis] Rendering file tree for:', structure.repoName, 'append:', append);
    
    const fileTree = document.getElementById('file-tree');
    const { repoName, participants } = structure;
    
    const participantKeys = Object.keys(participants).sort();
    
    // Build tree HTML: Project > Participants > Files
    let html = `
        <div class="tree-folder" onclick="toggleFolder(this)" data-expanded="false">
            <span class="tree-folder-icon">▶</span>
            <span>${repoName}</span>
        </div>
        <div class="tree-folder-content" style="margin-left: 10px;">
    `;
    
    participantKeys.forEach(participant => {
        const files = participants[participant];
        html += `
            <div class="tree-folder" onclick="toggleFolder(this)" data-expanded="false">
                <span class="tree-folder-icon">▶</span>
                <span>${participant}</span>
                <span style="color: var(--text-muted, #999); font-size: 0.85em; margin-left: 5px;">(${files.length})</span>
            </div>
            <div class="tree-folder-content" style="margin-left: 10px;">
        `;
        
        files.forEach(file => {
            const sizeKB = (file.size / 1024).toFixed(1);
            html += `
                <div class="tree-item" onclick="loadPlotFile('${file.url}', '${file.name}', '${participant}')" data-filename="${file.name.toLowerCase()}">
                    ${file.name}
                    <span style="color: var(--text-muted, #999); font-size: 0.8em; margin-left: 5px;">
                        (${sizeKB}KB)
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
    
    // Either replace or append
    if (append) {
        fileTree.innerHTML += html;
    } else {
        fileTree.innerHTML = html;
    }
    
    // Store globally for search and pipeline trace (extend if appending)
    if (!window.analysisData) {
        window.analysisData = { repos: [] };
    }
    if (append) {
        window.analysisData.repos = window.analysisData.repos || [];
        window.analysisData.repos.push(structure);
    } else {
        window.analysisData = { repos: [structure] };
    }
    
    console.log('[Analysis] File tree rendered successfully');
}

async function initAnalysisPage() {
    console.log('[Analysis] Initializing page - discovering repos...');
    
    const emptyState = document.getElementById('empty-state');
    
    // Show loading state
    emptyState.innerHTML = `
        <h2>Discovering Analysis Repositories...</h2>
        <p>Scanning GitHub for repositories with analysis results</p>
        <div class="spinner" style="width: 40px; height: 40px; border: 4px solid #ddd; border-top: 4px solid #c9a227; border-radius: 50%; animation: spin 1s linear infinite; margin: 20px auto;"></div>
    `;
    
    try {
        // Fetch GitHub username from our own data
        const baseUrl = (window.SITE_BASE_URL || '').replace(/\/$/, '') + '/';
        const githubDataResponse = await fetch(baseUrl + 'data/github.json');
        if (!githubDataResponse.ok) {
            throw new Error('Could not load GitHub data');
        }
        
        const githubData = await githubDataResponse.json();
        const username = githubData.repos && githubData.repos[0] 
            ? githubData.repos[0].url.split('/')[3]  // Extract username from URL
            : 'CGutt-hub';  // Fallback
        
        console.log('[Analysis] GitHub username:', username);
        
        // Discover all repos with *_results folders
        const analysisRepos = await discoverAnalysisRepos(username);
        
        if (analysisRepos.length === 0) {
            emptyState.innerHTML = `
                <h2>No Analysis Results Found</h2>
                <p>No repositories with <code>*_results</code> folders found for <strong>${username}</strong></p>
                <p style="color: var(--text-secondary); font-size: 0.9em; margin-top: 20px;">
                    To add a repository to this page:
                </p>
                <ol style="text-align: left; max-width: 500px; margin: 15px auto; line-height: 1.8;">
                    <li>Create a folder ending with <code>_results</code> (e.g., <code>EV_results</code>)</li>
                    <li>Add participant folders inside (e.g., <code>EV_002</code>, <code>EV_003</code>)</li>
                    <li>Add a <code>plots/</code> subfolder with <code>.parquet</code> files</li>
                    <li>This page will automatically discover and display them!</li>
                </ol>
            `;
            return;
        }
        
        console.log('[Analysis] Found', analysisRepos.length, 'analysis repos');
        
        // Build tree for each discovered repo
        let loadedCount = 0;
        for (const repoConfig of analysisRepos) {
            const structure = await buildTreeFromRepo(repoConfig);
            
            if (structure) {
                // Render tree in sidebar (append for multiple repos)
                renderFileTree(structure, loadedCount > 0);  // append=true for 2nd+ repos
                
                // Hide empty state after first successful load
                if (loadedCount === 0) {
                    emptyState.style.display = 'none';
                }
                
                // Fetch pipeline trace
                fetchPipelineTrace(`${structure.repoOwner}/${structure.repoName}`, structure.resultsDir);
                
                loadedCount++;
            }
        }
        
        if (loadedCount === 0) {
            emptyState.innerHTML = `
                <h2>Error Loading Repositories</h2>
                <p>Found ${analysisRepos.length} repos but could not load their data</p>
            `;
        } else {
            // Initialize search after all repos loaded
            const searchInput = document.getElementById('search-box');
            if (searchInput && !searchInput.hasAttribute('data-initialized')) {
                searchInput.setAttribute('data-initialized', 'true');
                searchInput.addEventListener('input', (e) => {
                    filterFileTree(e.target.value);
                });
            }
        }
        
    } catch (error) {
        console.error('[Analysis] Error initializing page:', error);
        emptyState.innerHTML = `
            <h2>Error Loading Data</h2>
            <p>Could not discover analysis repositories: ${error.message}</p>
            <p style="color: var(--text-secondary); font-size: 0.9em;">Check the console for details or try refreshing.</p>
        `;
    }
}

// Start when page loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAnalysisPage);
} else {
    initAnalysisPage();
}

// Expose functions to global scope for inline onclick handlers
window.loadPlotFile = loadPlotFile;
window.toggleFolder = toggleFolder;
window.exportPlotAsPNG = exportPlotAsPNG;
window.exportPlotAsSVG = exportPlotAsSVG;
window.exportPlotAsPDF = exportPlotAsPDF;
