using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Extensions.Logging;
using PredictiveDesktopLayer.Domain.Interfaces;
using PredictiveDesktopLayer.Domain.Models;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;
using SixLabors.ImageSharp.Processing;
using Vortice.Direct3D11;
using Vortice.DXGI;

namespace PredictiveDesktopLayer.Infrastructure.Capture;

public class WindowsGraphicsCapture : IScreenCapture
{
    private readonly ILogger<WindowsGraphicsCapture> _logger;
    private readonly IInactivityDetector _inactivityDetector;
    private ID3D11Device? _device;
    private ID3D11DeviceContext? _context;
    private IDXGIOutputDuplication? _outputDuplication;
    private bool _isRunning;
    private bool _disposed;

    public WindowsGraphicsCapture(
        ILogger<WindowsGraphicsCapture> logger,
        IInactivityDetector inactivityDetector)
    {
        _logger = logger;
        _inactivityDetector = inactivityDetector;
    }

    public Task StartAsync(CancellationToken cancellationToken = default)
    {
        if (_isRunning) return Task.CompletedTask;

        try
        {
            InitializeDirectX();
            _isRunning = true;
            _logger.LogInformation("Screen capture started");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to start screen capture");
            throw;
        }

        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken = default)
    {
        _isRunning = false;
        CleanupDirectX();
        _logger.LogInformation("Screen capture stopped");
        return Task.CompletedTask;
    }

    public async Task<CapturedFrame?> CaptureAsync(CancellationToken cancellationToken = default)
    {
        if (!_isRunning || _outputDuplication == null || _device == null || _context == null)
        {
            return null;
        }

        try
        {
            var result = _outputDuplication.AcquireNextFrame(100, out var frameInfo, out var resource);

            if (result.Failure)
            {
                return null;
            }

            try
            {
                using var texture = resource.QueryInterface<ID3D11Texture2D>();
                var description = texture.Description;

                var stagingDesc = new Texture2DDescription
                {
                    Width = description.Width,
                    Height = description.Height,
                    MipLevels = 1,
                    ArraySize = 1,
                    Format = description.Format,
                    SampleDescription = new SampleDescription(1, 0),
                    Usage = ResourceUsage.Staging,
                    CPUAccessFlags = CpuAccessFlags.Read,
                    BindFlags = BindFlags.None
                };

                using var stagingTexture = _device.CreateTexture2D(stagingDesc);
                _context.CopyResource(stagingTexture, texture);

                var mappedResource = _context.Map(stagingTexture, 0, MapMode.Read);

                try
                {
                    var imageData = await CaptureToJpegAsync(
                        mappedResource.DataPointer,
                        (int)description.Width,
                        (int)description.Height,
                        mappedResource.RowPitch,
                        cancellationToken);

                    var cursorPos = _inactivityDetector.GetCursorPosition();

                    return new CapturedFrame
                    {
                        ImageData = imageData,
                        CapturedAt = DateTime.UtcNow,
                        Width = (int)description.Width,
                        Height = (int)description.Height,
                        CursorX = cursorPos.X,
                        CursorY = cursorPos.Y
                    };
                }
                finally
                {
                    _context.Unmap(stagingTexture, 0);
                }
            }
            finally
            {
                resource?.Dispose();
                _outputDuplication.ReleaseFrame();
            }
        }
        catch (System.Runtime.InteropServices.COMException ex) when (ex.HResult == unchecked((int)0x887A0027))
        {
            _logger.LogDebug("Frame was not ready, retrying...");
            ReinitializeOutputDuplication();
            return null;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error capturing frame");
            return null;
        }
    }

    private void InitializeDirectX()
    {
        var featureLevels = new[]
        {
            Vortice.Direct3D.FeatureLevel.Level_11_1,
            Vortice.Direct3D.FeatureLevel.Level_11_0
        };

        D3D11.D3D11CreateDevice(
            null,
            Vortice.Direct3D.DriverType.Hardware,
            DeviceCreationFlags.BgraSupport,
            featureLevels,
            out _device,
            out _context);

        if (_device == null)
        {
            throw new InvalidOperationException("Failed to create D3D11 device");
        }

        InitializeOutputDuplication();
    }

    private void InitializeOutputDuplication()
    {
        using var dxgiDevice = _device!.QueryInterface<IDXGIDevice>();
        using var adapter = dxgiDevice.GetAdapter();
        adapter.EnumOutputs(0, out var output);
        using (output)
        {
            using var output1 = output.QueryInterface<IDXGIOutput1>();
            _outputDuplication = output1.DuplicateOutput(_device);
        }
    }

    private void ReinitializeOutputDuplication()
    {
        _outputDuplication?.Dispose();
        _outputDuplication = null;

        try
        {
            InitializeOutputDuplication();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to reinitialize output duplication");
        }
    }

    private static async Task<byte[]> CaptureToJpegAsync(
        IntPtr dataPointer,
        int width,
        int height,
        int rowPitch,
        CancellationToken cancellationToken)
    {
        return await Task.Run(() =>
        {
            using var image = new Image<Bgra32>(width, height);

            unsafe
            {
                var sourcePtr = (byte*)dataPointer;

                image.ProcessPixelRows(accessor =>
                {
                    for (int y = 0; y < height; y++)
                    {
                        var sourceRow = sourcePtr + y * rowPitch;
                        var destRow = accessor.GetRowSpan(y);

                        for (int x = 0; x < width; x++)
                        {
                            destRow[x] = new Bgra32(
                                sourceRow[x * 4 + 2],
                                sourceRow[x * 4 + 1],
                                sourceRow[x * 4 + 0],
                                255);
                        }
                    }
                });
            }

            using var ms = new MemoryStream();
            image.SaveAsJpeg(ms);
            return ms.ToArray();
        }, cancellationToken);
    }

    private void CleanupDirectX()
    {
        _outputDuplication?.Dispose();
        _outputDuplication = null;
        _context?.Dispose();
        _context = null;
        _device?.Dispose();
        _device = null;
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        CleanupDirectX();
        GC.SuppressFinalize(this);
    }
}
