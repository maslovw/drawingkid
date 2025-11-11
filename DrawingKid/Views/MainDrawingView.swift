//
//  MainDrawingView.swift
//  DrawingKid
//
//  Main drawing screen with canvas and controls
//

import SwiftUI
import PhotosUI

struct MainDrawingView: View {
    @StateObject private var viewModel = CanvasViewModel()
    @StateObject private var configViewModel = ConfigViewModel()

    @State private var showingColorPalette = false
    @State private var showingConfig = false
    @State private var showingImagePicker = false
    @State private var showingExportOptions = false
    @State private var selectedPhotoItem: PhotosPickerItem?

    var body: some View {
        NavigationView {
            ZStack {
                // Background and Canvas
                GeometryReader { geometry in
                    ZStack {
                        // Background image or white background
                        CanvasBackgroundView(image: viewModel.document.backgroundImage)

                        // PencilKit Canvas
                        DrawingCanvasView(
                            drawing: $viewModel.document.drawing,
                            tool: .constant(viewModel.getCurrentPKTool()),
                            backgroundImage: viewModel.document.backgroundImage,
                            onDrawingChanged: { newDrawing in
                                viewModel.updateDrawing(newDrawing)
                            }
                        )

                        // AI Detection Overlay
                        DetectionOverlayView(
                            detections: viewModel.detectedObjects,
                            canvasSize: CGSize(width: 800, height: 600),
                            isVisible: $viewModel.showingDetections
                        )
                    }
                }

                // Color Palette Popover
                if showingColorPalette {
                    VStack {
                        Spacer()
                        ColorPaletteView(
                            colors: configViewModel.config.visibleColors,
                            selectedColor: $viewModel.selectedColor,
                            onColorSelected: { color in
                                viewModel.selectColor(color)
                                showingColorPalette = false
                            }
                        )
                        .background(Color(.systemBackground))
                        .cornerRadius(15)
                        .shadow(radius: 10)
                        .padding()
                    }
                    .transition(.move(edge: .bottom))
                }

                // Toolbar at bottom
                VStack {
                    Spacer()
                    ToolbarView(
                        availableTools: configViewModel.config.visibleTools,
                        selectedTool: $viewModel.selectedTool,
                        canUndo: viewModel.canUndo,
                        canRedo: viewModel.canRedo,
                        onUndo: { viewModel.undo() },
                        onRedo: { viewModel.redo() },
                        onClear: { showClearAlert() },
                        onAnalyze: { analyzeDrawing() },
                        onImportImage: { showingImagePicker = true },
                        onExport: { showingExportOptions = true }
                    )
                    .padding(.bottom)
                }
            }
            .navigationTitle("Drawing Kid")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button(action: { showingColorPalette.toggle() }) {
                        Image(systemName: "paintpalette.fill")
                            .foregroundColor(viewModel.selectedColor)
                    }
                }

                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: { showingConfig = true }) {
                        Image(systemName: "gearshape.fill")
                    }
                }
            }
            .sheet(isPresented: $showingConfig) {
                ConfigView(viewModel: configViewModel)
            }
            .photosPicker(
                isPresented: $showingImagePicker,
                selection: $selectedPhotoItem,
                matching: .images
            )
            .onChange(of: selectedPhotoItem) { _, newValue in
                loadPhoto(from: newValue)
            }
            .confirmationDialog("Export Drawing", isPresented: $showingExportOptions) {
                Button("Save to Photos") { exportToPhotos() }
                Button("Share") { shareDrawing() }
                Button("Cancel", role: .cancel) {}
            }
        }
        .navigationViewStyle(.stack)
    }

    // MARK: - Helper Methods

    private func showClearAlert() {
        // In a real app, show an alert confirmation
        viewModel.clearDrawing()
    }

    private func analyzeDrawing() {
        guard configViewModel.config.enableAIDetection else { return }

        Task {
            await viewModel.analyzeDrawing()
        }
    }

    private func loadPhoto(from item: PhotosPickerItem?) {
        guard let item = item else { return }

        Task {
            if let data = try? await item.loadTransferable(type: Data.self),
               let image = UIImage(data: data) {
                await MainActor.run {
                    viewModel.setBackgroundImage(image)
                }
            }
        }
    }

    private func exportToPhotos() {
        let image = viewModel.exportImage(size: CGSize(width: 2048, height: 1536))
        UIImageWriteToSavedPhotosAlbum(image, nil, nil, nil)
    }

    private func shareDrawing() {
        let image = viewModel.exportImage(size: CGSize(width: 2048, height: 1536))

        let activityVC = UIActivityViewController(
            activityItems: [image],
            applicationActivities: nil
        )

        if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
           let window = windowScene.windows.first,
           let rootVC = window.rootViewController {
            rootVC.present(activityVC, animated: true)
        }
    }
}

#Preview {
    MainDrawingView()
}
