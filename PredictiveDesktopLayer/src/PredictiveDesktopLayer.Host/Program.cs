using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using PredictiveDesktopLayer.Application.Services;
using PredictiveDesktopLayer.Application.StateMachine;
using PredictiveDesktopLayer.Domain.Interfaces;
using PredictiveDesktopLayer.Infrastructure.Capture;
using PredictiveDesktopLayer.Infrastructure.CloudBrain;
using PredictiveDesktopLayer.Infrastructure.Highlight;
using PredictiveDesktopLayer.Infrastructure.Inactivity;
using PredictiveDesktopLayer.Infrastructure.Input;
using PredictiveDesktopLayer.Infrastructure.Persistence;
using PredictiveDesktopLayer.UI.Services;
using PredictiveDesktopLayer.UI.ViewModels;
using PredictiveDesktopLayer.UI.Windows;
using Serilog;
using WpfApplication = System.Windows.Application;
using ShutdownMode = System.Windows.ShutdownMode;

namespace PredictiveDesktopLayer.Host;

public class Program
{
    [STAThread]
    public static void Main(string[] args)
    {
        Log.Logger = new LoggerConfiguration()
            .MinimumLevel.Debug()
            .WriteTo.Console()
            .WriteTo.File("logs/pdl-.log", rollingInterval: RollingInterval.Day)
            .CreateLogger();

        try
        {
            Log.Information("Starting Predictive Desktop Layer");

            var app = new WpfApplication();
            app.ShutdownMode = ShutdownMode.OnExplicitShutdown;

            var host = Microsoft.Extensions.Hosting.Host.CreateDefaultBuilder(args)
                .UseSerilog()
                .ConfigureServices((context, services) =>
                {
                    ConfigureServices(context, services);
                })
                .Build();

            var startup = new AppStartup(host, app);
            startup.Run();
        }
        catch (Exception ex)
        {
            Log.Fatal(ex, "Application terminated unexpectedly");
        }
        finally
        {
            Log.CloseAndFlush();
        }
    }

    private static void ConfigureServices(HostBuilderContext context, IServiceCollection services)
    {
        // Configuration
        services.Configure<PulseLoopOptions>(context.Configuration.GetSection("Capture"));
        services.Configure<ActionExecutorOptions>(context.Configuration.GetSection("Execution"));
        services.Configure<CloudBrainOptions>(context.Configuration.GetSection("CloudBrain"));

        // Domain interfaces -> Infrastructure implementations
        services.AddSingleton<IInactivityDetector, MouseInactivityDetector>();
        services.AddSingleton<IFrameBuffer>(sp =>
        {
            var options = sp.GetRequiredService<IOptions<PulseLoopOptions>>().Value;
            return new FrameBufferManager(options.FramesPerSecond * options.BufferSeconds);
        });
        services.AddSingleton<IScreenCapture, WindowsGraphicsCapture>();
        services.AddSingleton<IInputSimulator, Win32InputSimulator>();
        services.AddSingleton<IActionParser, SemanticActionParser>();
        services.AddSingleton<IElementHighlighter, ElementHighlighter>();
        services.AddSingleton<IFeedbackStore, FeedbackStore>();

        // HTTP Client for Cloud Brain
        services.AddHttpClient<ICloudBrain, VlJepaClient>()
            .ConfigureHttpClient((sp, client) =>
            {
                var options = sp.GetRequiredService<IOptions<CloudBrainOptions>>().Value;
                client.Timeout = TimeSpan.FromMilliseconds(options.TimeoutMs);
            });

        // Application services
        services.AddSingleton<PulseStateMachine>();
        services.AddSingleton<ActionExecutor>();
        services.AddHostedService<PulseLoopService>();

        // UI services
        services.AddSingleton<SuggestionViewModel>();
        services.AddSingleton<AltKeyService>();
        services.AddSingleton<TrayIconService>();
    }
}

public class AppStartup
{
    private readonly IHost _host;
    private readonly WpfApplication _app;
    private SuggestionOverlay? _overlay;

    public AppStartup(IHost host, WpfApplication app)
    {
        _host = host;
        _app = app;
    }

    public void Run()
    {
        var viewModel = _host.Services.GetRequiredService<SuggestionViewModel>();
        var altKeyService = _host.Services.GetRequiredService<AltKeyService>();
        var trayService = _host.Services.GetRequiredService<TrayIconService>();
        var pulseLoop = _host.Services.GetServices<IHostedService>()
            .OfType<PulseLoopService>()
            .FirstOrDefault();

        // Initialize UI on STA thread
        _overlay = new SuggestionOverlay(viewModel);

        // Wire up events
        if (pulseLoop != null)
        {
            pulseLoop.SuggestionReady += (s, suggestion) =>
            {
                _app.Dispatcher.Invoke(() => viewModel.ShowSuggestion(suggestion));
            };

            pulseLoop.SuggestionDismissed += (s, e) =>
            {
                _app.Dispatcher.Invoke(() => viewModel.Hide());
            };

            viewModel.ApproveRequested += async (s, e) =>
            {
                viewModel.Hide();
                await pulseLoop.ApproveSuggestionAsync();
            };

            viewModel.DismissRequested += (s, e) =>
            {
                viewModel.Hide();
                pulseLoop.DismissSuggestion();
            };
        }

        altKeyService.SingleAltTap += async (s, e) =>
        {
            if (viewModel.IsVisible && pulseLoop != null)
            {
                _app.Dispatcher.Invoke(() => viewModel.Hide());
                await pulseLoop.ApproveSuggestionAsync();
            }
        };

        altKeyService.DoubleAltTap += (s, e) =>
        {
            if (viewModel.IsVisible)
            {
                _app.Dispatcher.Invoke(() => viewModel.Hide());
                pulseLoop?.DismissSuggestion();
            }
        };

        trayService.ExitRequested += (s, e) =>
        {
            _app.Dispatcher.Invoke(() =>
            {
                _host.StopAsync().Wait();
                _app.Shutdown();
            });
        };

        // Start services
        altKeyService.Start();
        trayService.Initialize();

        // Start host in background
        Task.Run(async () => await _host.RunAsync());

        // Run WPF app
        _app.Run();
    }
}
