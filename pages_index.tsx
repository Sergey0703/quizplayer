import React, { useState, useRef, useCallback } from 'react';

interface SRTEntry {
  timestamp: string;
  timeInSeconds: number;
  text: string;
  isQuestion: boolean;
}

interface Screenshot {
  id: string;
  url: string;
  timestamp: string;
  timeInSeconds: number;
  filename: string;
}

// Lazy import for JSZip to avoid SSR issues
const loadJSZip = async () => {
  try {
    const JSZip = await import('jszip');
    return JSZip.default;
  } catch (error) {
    console.error('Failed to load JSZip:', error);
    throw new Error('JSZip library not available');
  }
};

const loadFileSaver = async () => {
  try {
    const fileSaver = await import('file-saver');
    return fileSaver.saveAs;
  } catch (error) {
    console.error('Failed to load file-saver:', error);
    throw new Error('file-saver library not available');
  }
};

// Alternative download function using browser's download API
const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const VideoScreenshotGenerator: React.FC = () => {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [srtFile, setSrtFile] = useState<File | null>(null);
  const [srtEntries, setSrtEntries] = useState<SRTEntry[]>([]);
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [selectedScreenshots, setSelectedScreenshots] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<string[]>([]);
  const [videoLoaded, setVideoLoaded] = useState(false);
  const [libraryStatus, setLibraryStatus] = useState({ jszip: false, filesaver: false });
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Check library availability on component mount
  React.useEffect(() => {
    const checkLibraries = async () => {
      try {
        await loadJSZip();
        setLibraryStatus(prev => ({ ...prev, jszip: true }));
      } catch (error) {
        console.warn('JSZip not available:', error);
      }

      try {
        await loadFileSaver();
        setLibraryStatus(prev => ({ ...prev, filesaver: true }));
      } catch (error) {
        console.warn('file-saver not available:', error);
      }
    };

    checkLibraries();
  }, []);

  // Parse SRT file to extract timestamps and question markers
  const parseSRT = useCallback((content: string): SRTEntry[] => {
    const entries: SRTEntry[] = [];
    
    try {
      // Normalize line endings and split by double newlines
      const normalizedContent = content.replace(/\r/g, '');
      const blocks = normalizedContent.split('\n\n');
      
      blocks.forEach((block, index) => {
        const lines = block.trim().split('\n').filter(line => line.trim());
        
        if (lines.length >= 2) {
          // Look for timestamp line (could be first or second line)
          let timestampLine = '';
          let textLines: string[] = [];
          
          // Find the line with timestamp pattern
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.match(/\d{2}:\d{2}:\d{2}[,\.]\d{3}/)) {
              timestampLine = line;
              textLines = lines.slice(i + 1);
              break;
            }
          }
          
          if (timestampLine) {
            const text = textLines.join(' ').trim();
            // More flexible question detection - look for "question" anywhere in text
            const isQuestion = text.toLowerCase().includes('question');
            
            // Extract timestamp with flexible format
            const timestampMatch = timestampLine.match(/(\d{2}):(\d{2}):(\d{2})[,\.](\d{3})/);
            if (timestampMatch) {
              const [, hours, minutes, seconds, milliseconds] = timestampMatch;
              const timeInSeconds = parseInt(hours) * 3600 + parseInt(minutes) * 60 + 
                                   parseInt(seconds) + parseInt(milliseconds) / 1000;
              
              entries.push({
                timestamp: timestampLine,
                timeInSeconds,
                text,
                isQuestion
              });
            }
          }
        }
      });
      
      console.log('Parsed SRT entries:', entries.length);
      console.log('Question entries found:', entries.filter(e => e.isQuestion).length);
      
    } catch (error) {
      console.error('Error parsing SRT:', error);
      setErrors(prev => [...prev, 'Failed to parse SRT file format']);
    }
    
    return entries.filter(entry => entry.isQuestion);
  }, []);

  // Wait for video to be loaded and ready
  const waitForVideoReady = useCallback((): Promise<void> => {
    return new Promise((resolve, reject) => {
      const video = videoRef.current;
      if (!video) {
        reject(new Error('Video element not found'));
        return;
      }

      if (video.readyState >= 2 && video.videoWidth > 0) {
        resolve();
        return;
      }

      const handleCanPlay = () => {
        console.log('Video can play');
        video.removeEventListener('canplay', handleCanPlay);
        video.removeEventListener('loadedmetadata', handleLoadedMetadata);
        video.removeEventListener('error', handleError);
        resolve();
      };

      const handleLoadedMetadata = () => {
        console.log('Video metadata loaded');
        video.removeEventListener('canplay', handleCanPlay);
        video.removeEventListener('loadedmetadata', handleLoadedMetadata);
        video.removeEventListener('error', handleError);
        resolve();
      };

      const handleError = () => {
        console.error('Video error');
        video.removeEventListener('canplay', handleCanPlay);
        video.removeEventListener('loadedmetadata', handleLoadedMetadata);
        video.removeEventListener('error', handleError);
        reject(new Error('Failed to load video'));
      };

      video.addEventListener('canplay', handleCanPlay);
      video.addEventListener('loadedmetadata', handleLoadedMetadata);
      video.addEventListener('error', handleError);

      // Timeout after 10 seconds
      setTimeout(() => {
        video.removeEventListener('canplay', handleCanPlay);
        video.removeEventListener('loadedmetadata', handleLoadedMetadata);
        video.removeEventListener('error', handleError);
        reject(new Error('Video loading timeout'));
      }, 10000);
    });
  }, []);

  // Capture screenshot at specific timestamp
  const captureScreenshot = useCallback(async (timeInSeconds: number, index: number): Promise<Screenshot> => {
    return new Promise((resolve, reject) => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      
      if (!video || !canvas) {
        reject(new Error('Video or canvas not available'));
        return;
      }

      // Check if time is within video duration
      if (timeInSeconds > video.duration) {
        reject(new Error(`Timestamp ${timeInSeconds}s exceeds video duration ${video.duration}s`));
        return;
      }

      let seekTimeout: NodeJS.Timeout;
      let isResolved = false;

      const cleanup = () => {
        video.removeEventListener('seeked', handleSeeked);
        video.removeEventListener('error', handleVideoError);
        if (seekTimeout) clearTimeout(seekTimeout);
      };

      const handleSeeked = () => {
        if (isResolved) return;
        isResolved = true;
        cleanup();
        
        try {
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Canvas context not available'));
            return;
          }

          // Set canvas size to video dimensions
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          
          // Draw video frame to canvas
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          
          // Convert canvas to blob
          canvas.toBlob((blob) => {
            if (!blob) {
              reject(new Error('Failed to create image blob'));
              return;
            }
            
            const url = URL.createObjectURL(blob);
            const timestamp = formatTimestamp(timeInSeconds);
            const filename = `screenshot_${(index + 1).toString().padStart(3, '0')}_${timestamp.replace(/:/g, '-')}.png`;
            
            resolve({
              id: `${Date.now()}_${index}`,
              url,
              timestamp,
              timeInSeconds,
              filename
            });
          }, 'image/png');
          
        } catch (error) {
          reject(error);
        }
      };

      const handleVideoError = () => {
        if (isResolved) return;
        isResolved = true;
        cleanup();
        reject(new Error('Video seek error'));
      };

      // Set up event listeners
      video.addEventListener('seeked', handleSeeked);
      video.addEventListener('error', handleVideoError);
      
      // Set timeout for seek operation
      seekTimeout = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          cleanup();
          reject(new Error(`Seek timeout at ${timeInSeconds}s`));
        }
      }, 5000);
      
      try {
        console.log(`Seeking to ${timeInSeconds}s`);
        video.currentTime = timeInSeconds;
      } catch (error) {
        if (!isResolved) {
          isResolved = true;
          cleanup();
          reject(error);
        }
      }
    });
  }, []);

  // Format timestamp for display
  const formatTimestamp = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
  };

  // Handle video file upload
  const handleVideoUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (file.type.startsWith('video/')) {
        setVideoFile(file);
        setErrors([]);
        setVideoLoaded(false);
        
        // Clean up previous video URL
        if (videoUrl) {
          URL.revokeObjectURL(videoUrl);
        }
        
        const newVideoUrl = URL.createObjectURL(file);
        setVideoUrl(newVideoUrl);
      } else {
        setErrors(['Please select a valid video file']);
      }
    }
  }, [videoUrl]);

  // Handle SRT file upload and parsing
  const handleSRTUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      try {
        const content = await file.text();
        const entries = parseSRT(content);
        
        setSrtFile(file);
        setSrtEntries(entries);
        setErrors([]);
        
        if (entries.length === 0) {
          setErrors(['No "question" timestamps found in SRT file']);
        }
      } catch (error) {
        console.error('Error reading SRT file:', error);
        setErrors(['Failed to read SRT file']);
      }
    }
  }, [parseSRT]);

  // Handle video load event
  const handleVideoLoaded = useCallback(() => {
    console.log('Video loaded successfully');
    setVideoLoaded(true);
  }, []);

  // Generate screenshots for all question timestamps
  const generateScreenshots = useCallback(async () => {
    if (!videoFile || !srtEntries.length || !videoUrl) {
      setErrors(['Please upload both video and SRT files with question timestamps']);
      return;
    }

    setIsProcessing(true);
    setProcessingProgress(0);
    setScreenshots([]);
    setSelectedScreenshots(new Set());
    setErrors([]);

    try {
      // Wait for video to be fully loaded
      console.log('Waiting for video to be ready...');
      await waitForVideoReady();
      console.log('Video is ready');
      
      const newScreenshots: Screenshot[] = [];
      
      for (let i = 0; i < srtEntries.length; i++) {
        const entry = srtEntries[i];
        
        try {
          // Add delay between captures to prevent overwhelming the browser
          if (i > 0) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          
          const screenshot = await captureScreenshot(entry.timeInSeconds, i);
          newScreenshots.push(screenshot);
          
          console.log(`Captured screenshot ${i + 1}/${srtEntries.length}`);
        } catch (error) {
          console.error(`Failed to capture screenshot at ${entry.timestamp}:`, error);
          setErrors(prev => [...prev, `Failed to capture screenshot at ${entry.timestamp}`]);
        }
        
        // Update progress
        setProcessingProgress(((i + 1) / srtEntries.length) * 100);
      }
      
      setScreenshots(newScreenshots);
      
      if (newScreenshots.length === 0) {
        setErrors(['No screenshots were successfully captured']);
      } else if (newScreenshots.length < srtEntries.length) {
        setErrors(prev => [...prev, `Only ${newScreenshots.length} of ${srtEntries.length} screenshots were captured`]);
      }
    } catch (error) {
      console.error('Error generating screenshots:', error);
      setErrors([`Failed to generate screenshots: ${error instanceof Error ? error.message : 'Unknown error'}`]);
    } finally {
      setIsProcessing(false);
    }
  }, [videoFile, srtEntries, videoUrl, captureScreenshot, waitForVideoReady]);

  // Download single screenshot
  const downloadSingleScreenshot = useCallback(async (screenshot: Screenshot) => {
    try {
      const response = await fetch(screenshot.url);
      const blob = await response.blob();
      downloadBlob(blob, screenshot.filename);
    } catch (error) {
      console.error('Error downloading screenshot:', error);
      alert(`Failed to download ${screenshot.filename}`);
    }
  }, []);

  // Download selected screenshots as zip
  const downloadSelectedScreenshots = useCallback(async () => {
    if (selectedScreenshots.size === 0) {
      setErrors(['Please select at least one screenshot to download']);
      return;
    }

    const selectedScreens = screenshots.filter(screenshot => 
      selectedScreenshots.has(screenshot.id)
    );

    try {
      // Check if libraries are available
      if (!libraryStatus.jszip || !libraryStatus.filesaver) {
        throw new Error('Download libraries not available');
      }

      const JSZip = await loadJSZip();
      const saveAs = await loadFileSaver();
      
      const zip = new JSZip();

      for (const screenshot of selectedScreens) {
        const response = await fetch(screenshot.url);
        const blob = await response.blob();
        zip.file(screenshot.filename, blob);
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
      saveAs(zipBlob, `screenshots_${timestamp}.zip`);
      
      setErrors([]); // Clear any previous errors
    } catch (error) {
      console.error('Error creating zip download:', error);
      
      // Fallback to individual downloads
      if (error instanceof Error && error.message.includes('not available')) {
        setErrors(['Download libraries not available. Downloading screenshots individually...']);
        
        // Trigger individual downloads with delay
        for (let i = 0; i < selectedScreens.length; i++) {
          setTimeout(() => {
            downloadSingleScreenshot(selectedScreens[i]);
          }, i * 500); // 500ms delay between downloads
        }
      } else {
        setErrors(['Failed to create download archive. Downloading individually...']);
        
        // Trigger individual downloads
        for (let i = 0; i < selectedScreens.length; i++) {
          setTimeout(() => {
            downloadSingleScreenshot(selectedScreens[i]);
          }, i * 500);
        }
      }
    }
  }, [selectedScreenshots, screenshots, libraryStatus, downloadSingleScreenshot]);

  // Download all screenshots
  const downloadAllScreenshots = useCallback(async () => {
    if (screenshots.length === 0) {
      setErrors(['No screenshots available to download']);
      return;
    }

    try {
      // Check if libraries are available
      if (!libraryStatus.jszip || !libraryStatus.filesaver) {
        throw new Error('Download libraries not available');
      }

      const JSZip = await loadJSZip();
      const saveAs = await loadFileSaver();
      
      const zip = new JSZip();

      for (const screenshot of screenshots) {
        const response = await fetch(screenshot.url);
        const blob = await response.blob();
        zip.file(screenshot.filename, blob);
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
      saveAs(zipBlob, `all_screenshots_${timestamp}.zip`);
      
      setErrors([]); // Clear any previous errors
    } catch (error) {
      console.error('Error creating zip download:', error);
      
      // Fallback to individual downloads
      if (error instanceof Error && error.message.includes('not available')) {
        setErrors(['Download libraries not available. Downloading screenshots individually...']);
        
        // Trigger individual downloads with delay
        for (let i = 0; i < screenshots.length; i++) {
          setTimeout(() => {
            downloadSingleScreenshot(screenshots[i]);
          }, i * 500); // 500ms delay between downloads
        }
      } else {
        setErrors(['Failed to create zip file. Downloading screenshots individually...']);
        
        // Trigger individual downloads
        for (let i = 0; i < screenshots.length; i++) {
          setTimeout(() => {
            downloadSingleScreenshot(screenshots[i]);
          }, i * 500);
        }
      }
    }
  }, [screenshots, libraryStatus, downloadSingleScreenshot]);

  // Toggle screenshot selection
  const toggleScreenshotSelection = useCallback((screenshotId: string) => {
    setSelectedScreenshots(prev => {
      const newSelected = new Set(prev);
      if (newSelected.has(screenshotId)) {
        newSelected.delete(screenshotId);
      } else {
        newSelected.add(screenshotId);
      }
      return newSelected;
    });
  }, []);

  // Select/deselect all screenshots
  const toggleSelectAll = useCallback(() => {
    setSelectedScreenshots(prev => {
      if (prev.size === screenshots.length) {
        return new Set();
      } else {
        return new Set(screenshots.map(s => s.id));
      }
    });
  }, [screenshots]);

  // Clean up object URLs
  React.useEffect(() => {
    return () => {
      screenshots.forEach(screenshot => {
        URL.revokeObjectURL(screenshot.url);
      });
      if (videoUrl) {
        URL.revokeObjectURL(videoUrl);
      }
    };
  }, [screenshots, videoUrl]);

  // Check if generate button should be enabled
  const canGenerate = videoFile && srtEntries.length > 0 && videoLoaded && !isProcessing;

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="bg-white rounded-lg shadow-lg p-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-8 text-center">
            Video Quiz Screenshot Generator
          </h1>
          
          {/* Library Status Warning */}
          {(!libraryStatus.jszip || !libraryStatus.filesaver) && (
            <div className="mb-6 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <h3 className="text-yellow-800 font-semibold mb-2">⚠️ Download Libraries Missing</h3>
              <p className="text-yellow-700 text-sm">
                Some download libraries are not available. Screenshots will be downloaded individually instead of as a zip file.
                To get zip downloads, install: <code className="bg-yellow-100 px-1 rounded">npm install jszip file-saver</code>
              </p>
            </div>
          )}
          
          {/* Error Display */}
          {errors.length > 0 && (
            <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
              <h3 className="text-red-800 font-semibold mb-2">Errors:</h3>
              <ul className="text-red-700 text-sm space-y-1">
                {errors.map((error, index) => (
                  <li key={index}>• {error}</li>
                ))}
              </ul>
            </div>
          )}
          
          {/* File Upload Section */}
          <div className="grid md:grid-cols-2 gap-8 mb-8">
            {/* Video Upload */}
            <div className="space-y-4">
              <h2 className="text-xl font-semibold text-gray-800">Upload Video</h2>
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-blue-400 transition-colors">
                <input
                  type="file"
                  accept="video/*"
                  onChange={handleVideoUpload}
                  className="hidden"
                  id="video-upload"
                />
                <label htmlFor="video-upload" className="cursor-pointer">
                  <div className="text-4xl text-gray-400 mb-2">📹</div>
                  <p className="text-gray-600 mb-2">Click to select video file</p>
                  <p className="text-sm text-gray-500">Supports MP4, AVI, MOV, and other video formats</p>
                </label>
              </div>
              {videoFile && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <p className="text-blue-800 font-medium">{videoFile.name}</p>
                  <p className="text-blue-600 text-sm">{(videoFile.size / (1024 * 1024)).toFixed(2)} MB</p>
                  <p className={`text-sm mt-1 ${videoLoaded ? 'text-green-600' : 'text-orange-600'}`}>
                    {videoLoaded ? '✓ Video loaded and ready' : '⏳ Loading video...'}
                  </p>
                </div>
              )}
            </div>

            {/* SRT Upload */}
            <div className="space-y-4">
              <h2 className="text-xl font-semibold text-gray-800">Upload SRT File</h2>
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-green-400 transition-colors">
                <input
                  type="file"
                  accept=".srt,text/plain"
                  onChange={handleSRTUpload}
                  className="hidden"
                  id="srt-upload"
                />
                <label htmlFor="srt-upload" className="cursor-pointer">
                  <div className="text-4xl text-gray-400 mb-2">📝</div>
                  <p className="text-gray-600 mb-2">Click to select SRT file</p>
                  <p className="text-sm text-gray-500">Subtitle file with timestamps</p>
                </label>
              </div>
              {srtFile && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                  <p className="text-green-800 font-medium">{srtFile.name}</p>
                  <p className="text-green-600 text-sm">{srtEntries.length} question timestamps found</p>
                </div>
              )}
            </div>
          </div>

          {/* Question Timestamps Preview */}
          {srtEntries.length > 0 && (
            <div className="mb-8">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">
                Found {srtEntries.length} Question Timestamps
              </h3>
              <div className="bg-gray-50 rounded-lg p-4 max-h-48 overflow-y-auto">
                {srtEntries.map((entry, index) => (
                  <div key={index} className="flex items-center justify-between py-2 border-b border-gray-200 last:border-b-0">
                    <div>
                      <span className="font-mono text-blue-600 font-medium">{entry.timestamp}</span>
                      <p className="text-sm text-gray-600 mt-1">{entry.text.substring(0, 100)}...</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Generate Button */}
          <div className="text-center mb-8">
            <button
              onClick={generateScreenshots}
              disabled={!canGenerate}
              className={`font-semibold py-3 px-8 rounded-lg transition-colors ${
                canGenerate
                  ? 'bg-blue-600 hover:bg-blue-700 text-white'
                  : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }`}
            >
              {isProcessing ? (
                <span className="flex items-center">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Generating Screenshots... {Math.round(processingProgress)}%
                </span>
              ) : (
                'Generate Screenshots'
              )}
            </button>
            
            {/* Button status indicator */}
            {!canGenerate && !isProcessing && (
              <p className="text-sm text-gray-500 mt-2">
                {!videoFile && "Please upload a video file"}
                {videoFile && !videoLoaded && "Please wait for video to load"}
                {videoFile && videoLoaded && srtEntries.length === 0 && "Please upload an SRT file with question timestamps"}
              </p>
            )}
          </div>

          {/* Progress Bar */}
          {isProcessing && (
            <div className="mb-8">
              <div className="bg-gray-200 rounded-full h-2">
                <div 
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${processingProgress}%` }}
                ></div>
              </div>
            </div>
          )}

          {/* Screenshots Display */}
          {screenshots.length > 0 && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-semibold text-gray-800">
                  Generated Screenshots ({screenshots.length})
                </h3>
                <div className="flex space-x-4">
                  <button
                    onClick={toggleSelectAll}
                    className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-lg transition-colors"
                  >
                    {selectedScreenshots.size === screenshots.length ? 'Deselect All' : 'Select All'}
                  </button>
                  <button
                    onClick={downloadSelectedScreenshots}
                    disabled={selectedScreenshots.size === 0}
                    className="bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white px-4 py-2 rounded-lg transition-colors"
                  >
                    Download Selected ({selectedScreenshots.size})
                  </button>
                  <button
                    onClick={downloadAllScreenshots}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors"
                  >
                    Download All
                  </button>
                </div>
              </div>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {screenshots.map((screenshot) => (
                  <div 
                    key={screenshot.id} 
                    className={`bg-white rounded-lg shadow-md overflow-hidden border-2 transition-all ${
                      selectedScreenshots.has(screenshot.id) ? 'border-blue-500' : 'border-gray-200'
                    }`}
                  >
                    <div className="relative group">
                      <img
                        src={screenshot.url}
                        alt={`Screenshot at ${screenshot.timestamp}`}
                        className="w-full h-48 object-cover cursor-pointer"
                        onClick={() => toggleScreenshotSelection(screenshot.id)}
                      />
                      <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-30 transition-all duration-200 flex items-center justify-center">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleScreenshotSelection(screenshot.id);
                          }}
                          className="opacity-0 group-hover:opacity-100 bg-white text-gray-800 px-3 py-1 rounded-full text-sm font-medium transition-all duration-200 mr-2"
                        >
                          {selectedScreenshots.has(screenshot.id) ? 'Deselect' : 'Select'}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            downloadSingleScreenshot(screenshot);
                          }}
                          className="opacity-0 group-hover:opacity-100 bg-blue-600 text-white px-3 py-1 rounded-full text-sm font-medium transition-all duration-200"
                        >
                          Download
                        </button>
                      </div>
                    </div>
                    <div className="p-4">
                      <p className="font-mono text-sm text-gray-600 mb-1">{screenshot.timestamp}</p>
                      <p className="text-xs text-gray-500">{screenshot.filename}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Hidden elements for processing */}
          <video
            ref={videoRef}
            src={videoUrl}
            style={{ display: 'none' }}
            crossOrigin="anonymous"
            onLoadedData={handleVideoLoaded}
            onCanPlay={handleVideoLoaded}
            preload="auto"
          />
          <canvas ref={canvasRef} style={{ display: 'none' }} />
        </div>
      </div>
    </div>
  );
};

export default VideoScreenshotGenerator;
