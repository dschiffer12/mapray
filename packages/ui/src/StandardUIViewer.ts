import mapray from "@mapray/mapray-js";

var GeoMath = mapray.GeoMath;
var GeoPoint = mapray.GeoPoint;



/**
 * 標準 Mapray Viewer
 *
 * コアライブラリのラッパです。
 * マウス操作やキーボード操作など一般的な操作がサポートされます。
 *
 * ```js
 * import mapray from "@mapray/mapray-js";
 * import maprayui from "@mapray/ui";
 *
 * const node = document.getElementById("id"); // HTMLElement要素を取得します
 * const ACCESS_TOKEN = "..."; // 事前に取得した値を指定します。
 *
 * const stdViewer = new maprayui.StandardUIViewer( node, ACCESS_TOKEN );
 *
 * const mtFujiPosition = new mapray.GeoPoint(138.72884, 35.36423, 0);
 *
 * // カメラ視点の変更
 * stdViewer.setCameraPosition({
 *   longitude: mtFujiPosition.longitude,
 *   latitude: mtFujiPosition.latitude - 0.05,
 *   height: mtFujiPosition.altitude + 6000
 * });
 *
 * // カメラ視線先の変更
 * stdViewer.setLookAtPosition({
 *   longitude: mtFujiPosition.longitude,
 *   latitude: mtFujiPosition.latitude,
 *   height: mtFujiPosition.altitude + 3000
 * });
 *
 * const pin = new mapray.PinEntity(stdViewer.viewer.scene)
 * pin.altitude_mode = mapray.AltitudeMode.RELATIVE;
 * pin.addMakiIconPin( "mountain-15", mtFujiPosition );
 * stdViewer.addEntity(pin);
 * ```
 */
class StandardUIViewer extends mapray.RenderCallback
{

    private _camera_parameter: StandardUIViewer.CameraParameter & StandardUIViewer.RollPitchYawData & mapray.GeoPointData;

    private _last_camera_parameter: StandardUIViewer.CameraParameter & StandardUIViewer.RollPitchYawData & mapray.GeoPointData;

    private _operation_mode: StandardUIViewer.OperationMode;

    /** マウスダウンした位置 */
    private _mouse_down_position: [ x: number, y: number ];

    /** 直前のマウス位置 */
    private _pre_mouse_position: [ x: number, y: number ];

    /** 回転中心 */
    private _rotate_center: mapray.Vector3 | null

    /** 平行移動の移動量（マウスの移動量） */
    private _translate_drag: mapray.Vector2;

    /** 平行移動の移動量（マウスの移動量） */
    private _translate_eye_drag: mapray.Vector2;

    /** 回転の移動量（マウスの移動量） */
    private _rotate_drag: mapray.Vector2;

    /** 自由回転の移動量（マウスの移動量） */
    private _free_rotate_drag: mapray.Vector2;

    /** 高度変更の移動量（マウスの移動量） */
    private _height_drag: mapray.Vector2;

    /** 視線方向への移動量（ホイールの移動量） */
    private _zoom_wheel: number;

    /** 画角変更の指定回数 */
    private _fovy_key: number;

    /** リセット用の画角 */
    private _default_fov = StandardUIViewer.DEFAULT_CAMERA_PARAMETER.fov;

    /** キー操作中 */
    private _key_mode: boolean;

    /** URLHash更新フラグ */
    private _update_url_hash: boolean;

    private _update_url_hash_backup: boolean;

    /** URLに含む値の桁数(true:全桁, false:桁数制限) */
    private _update_url_hash_full_digits: boolean;

    private _viewerCameraMode: StandardUIViewer.CameraMode;

    private _animation: mapray.animation.EasyBindingBlock;

    private _updater: mapray.animation.Updater;

    private _curve_move?: mapray.animation.KFLinearCurve;

    private _curve_rotation?: mapray.animation.KFLinearCurve;

    private _flycamera_total_time: number;

    private _flycamera_target_time: number;

    private _flycamera_on_success?: () => void;

    private _controllable: boolean;

    private _altitude_range: { min: number, max: number };

    private _selfHashChangeFlag: boolean;

    /**
     * コンストラクタ
     * @param container                               ビューワ作成先のコンテナ（IDまたは要素）
     * @param access_token                            アクセストークン
     * @param {object}                      options                                 生成オプション
     */
    constructor( container: string | HTMLElement, access_token: string, options: StandardUIViewer.Option = {} )
    {
        super();

        this.createViewer( container, access_token, options );

        // カメラパラメータ
        this._camera_parameter = {
            latitude: 0,         // 緯度
            longitude: 0,        // 経度
            height: 0,           // 高度
            pitch: 0,            // 上下（X軸）回転
            yaw: 0,              // 左右（Z軸）回転
            fov: 0,              // 画角
            near: 0,             // 近接平面距離
            far: 0,              // 遠方平面距離
            roll: 0,
            speed_factor: 2000,
        };

        this._operation_mode = StandardUIViewer.OperationMode.NONE;

        this._mouse_down_position = [ 0, 0 ];
        this._pre_mouse_position = [ 0, 0 ];
        this._rotate_center = GeoMath.createVector3();

        this._translate_drag = GeoMath.createVector2f();
        this._translate_eye_drag = GeoMath.createVector2f();
        this._rotate_drag = GeoMath.createVector2f();
        this._free_rotate_drag = GeoMath.createVector2f();
        this._height_drag = GeoMath.createVector2f();

        this._zoom_wheel = 0;
        this._fovy_key = 0;

        this._default_fov = StandardUIViewer.DEFAULT_CAMERA_PARAMETER.fov;

        this._key_mode = false;

        this._update_url_hash = false;
        this._update_url_hash_backup = false;
        this._update_url_hash_full_digits = false;

        this._last_camera_parameter = {
          latitude: -1,         // 緯度
          longitude: -1,        // 経度
          height: 0,           // 高度
          pitch: 0,            // 上下（X軸）回転
          yaw: 0,              // 左右（Z軸）回転
          fov: 0,              // 画角
          near: 0,             // 近接平面距離
          far: 0,              // 遠方平面距離
          roll: 0,
          speed_factor: 2000,
        }

        // for FlyCamera
        this._viewerCameraMode = StandardUIViewer.CameraMode.CAMERA_FREE;
        this._animation = new mapray.animation.EasyBindingBlock();
        this._updater = new mapray.animation.Updater();
        this._flycamera_total_time = 0;
        this._flycamera_target_time = 0;

        this._altitude_range = {
            min: StandardUIViewer.ALTITUDE_RANGE.min,
            max: StandardUIViewer.ALTITUDE_RANGE.max || Number.MAX_VALUE,
        };

        // カメラパラメータの初期化
        this._initCameraParameter( options );

        this._controllable = true;

        this._selfHashChangeFlag = false;

        // イベントリスナーの追加
        this._addEventListener();
    }

    /**
     * ビューワの作成
     * @param container                               ビューワ作成先のコンテナ（IDまたは要素）
     * @param access_token                            アクセストークン
     * @param options                                 生成オプション
     */
    protected createViewer( container: string | HTMLElement, access_token: string, options: StandardUIViewer.Option = {} )
    {
        if ( this._viewer ) {
            this.destroy();
        }

        const viewer = this._viewer = new mapray.Viewer(
            container, {
                dem_provider: this.createDemProvider( access_token, options ),
                north_pole: options.north_pole,
                south_pole: options.south_pole,
                image_provider: this.createImageProvider( options ),
                layers: options.layers,
                render_callback: this,
                ground_visibility: ( options && (options.ground_visibility !== undefined)) ? options.ground_visibility : true,
                entity_visibility: ( options && (options.entity_visibility !== undefined)) ? options.entity_visibility : true,
                render_mode: ( options && options.render_mode ) || mapray.Viewer.RenderMode.SURFACE,
                debug_stats: ( options && options.debug_stats ),
                attribution_controller: ( options && options.attribution_controller ),
                atmosphere: ( options && options.atmosphere ),
                sun_visualizer: ( options && options.sun_visualizer ),
                moon_visualizer: ( options && options.moon_visualizer ),
                cloud_visualizer: ( options && options.cloud_visualizer ),
                star_visualizer: ( options && options.star_visualizer ),
            }
        );

        // 右クリックメニューの無効化
        var element = viewer.canvas_element;
        element.setAttribute( "oncontextmenu", "return false;" );

        // For getting KeybordEvent
        element.setAttribute('tabindex', '0');

        return this._viewer;
    }

    /**
     * 破棄関数
     */
    destroy()
    {
        if ( !this._viewer )
        {
            return;
        }

        this._removeEventListener()

        this._viewer.destroy();
    }

    /**
     * ビューワ
     */
    get viewer(): mapray.Viewer
    {
        return this._viewer as mapray.Viewer;
    }

    /**
     * DEMプロバイダの生成
     *
     * @param access_token アクセストークン
     * @param options      生成オプション
     * @returns            DEMプロバイダ
     */
    protected createDemProvider( access_token: string, options: StandardUIViewer.Option ): mapray.DemProvider<any>
    {
        // @ts-ignore
        return options.dem_provider || new mapray.CloudDemProvider( access_token );
    }

    /**
     * 画像プロバイダの生成
     *
     * @param options 生成オプション
     * @returns       画像プロバイダ
     */
    protected createImageProvider( options: StandardUIViewer.Option ): mapray.ImageProvider
    {
        // @ts-ignore
        return options.image_provider || new mapray.StandardImageProvider( "https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/", ".jpg", 256, 2, 18 );
    }

    /**
     * カメラパラメータの初期化
     *
     * @param options オプション
     */
    private _initCameraParameter( options: StandardUIViewer.Option )
    {
        var camera_position = options.camera_position || StandardUIViewer.DEFAULT_CAMERA_POSITION;
        var lookat_position = options.lookat_position || StandardUIViewer.DEFAULT_LOOKAT_POSITION;
        var camera_parameter = options.camera_parameter || StandardUIViewer.DEFAULT_CAMERA_PARAMETER;

        // カメラ位置の設定
        this.setCameraPosition( camera_position );

        //　注視点位置の設定
        this.setLookAtPosition( lookat_position );

        // カメラパラメータの設定
        this.setCameraParameter( camera_parameter );

        // カメラ姿勢の確定
        this.updateCamera();
    }


    /**
     * URL Hash 書き換え機能を有効にします。
     * カメラ移動時に自動的に URL Hash を書き換えます。
     * @param readUrlOnStart true の場合、関数呼び出し時に URL Hash で示される位置に移動します。
     */
    enableURLUpdate( readUrlOnStart: boolean ): void
    {
        if ( readUrlOnStart ) {
            this._restoreCameraParameterFromHash();
        }
        this._update_url_hash = true;
    }


    /**
     * URL Hash 書き換え機能を無効にします。
     */
    disableURLUpdate(): void
    {
        this._update_url_hash = false;
    }


    /**
     * URLHash変更イベント
     */
     private _onHashChange(): void
     {
         if ( this._selfHashChangeFlag ) {
             this._selfHashChangeFlag = false;
             return;
         }

         this._restoreCameraParameterFromHash();
     }


     /**
      * URL Hashの値を取得し、カメラ位置を更新します。
      */
     private _restoreCameraParameterFromHash(): void
     {
         const param = this.getCameraParameterFromHash( window.location.hash );
         if ( !param ) {
             return;
         }
         this.setCameraPosition( param.camera_position );
         this.setLookAtPosition( param.lookat_position, param.yaw );
         this.updateCamera();
     }


    /**
     * URL Hashからカメラパラメータを取り出す。
     * @param urlHash hash string
     * @returns パラメータが不足、不正な場合は undefined
     */
    getCameraParameterFromHash( urlHash: string ): CameraPositionOption | undefined
    {
        if ( urlHash.length === 0 || urlHash[0] !== "#" ) {
            return undefined;
        }

        const params = urlHash.slice( 1 ).split( "/" );
        if ( params.length < 2 ) { // 必須項目が不足
            return undefined;
        }

        // 1, 2番目のパラメータは latitude, longitude
        const latitude  = parseFloat( params[0] );
        const longitude = parseFloat( params[1] );
        if ( isNaN( latitude ) || isNaN( longitude ) ) {
            return undefined;
        }

        // パラメータの解析
        const paramMap: { [key: string]: number } = {};
        for ( let i = 2; i < params.length; i++ ) {
            const param = params[i];
            const key = param.slice( -1 );
            const value = parseFloat( param.slice( 0, -1 ) );
            if ( isNaN( value ) ) {
                continue;
            }
            paramMap[key] = value;
        }

        // const altitude = this._viewer.getElevation( latitude, longitude );
        const altitude = paramMap["a"] !== undefined ? paramMap["a"] : 8000.0;
        const range    = paramMap["r"] !== undefined ? paramMap["r"] : 1000.0;
        const tilt     = paramMap["t"] !== undefined ? paramMap["t"] : 0.0;
        const heading  = paramMap["h"] !== undefined ? paramMap["h"] : 0.0;

        const tilt_rad    = tilt * GeoMath.DEGREE;
        const camera_z    = range * Math.cos( tilt_rad );
        const flat_length = range * Math.sin( tilt_rad );

        const camera_geoPoint = this._getOffsetPoint( longitude, latitude, flat_length, heading, new GeoPoint() );

        return {
            camera_position: {
                height: altitude + camera_z,
                longitude: camera_geoPoint.longitude,
                latitude: camera_geoPoint.latitude,
            },
            lookat_position: {
                height: altitude,
                longitude: longitude,
                latitude: latitude,
            },
            yaw: heading,
        };
    }


    // private _addHash()
    // {
    //     var self = this;
    //     this._onHashChange = this._onHashChange.bind(this);
    //     window.addEventListener("hashchange", self._onHashChange, { passive: false } );

    // }

    /**
     * イベントリスナーの追加
     */
    private _addEventListener()
    {
        // @ts-ignore;
        const viewer: Viewer = this._viewer;

        var canvas = viewer._canvas_element;
        var self = this;

        this._onBlur = this._onBlur.bind(this);
        this._onMouseDown = this._onMouseDown.bind(this);
        this._onMouseMove = this._onMouseMove.bind(this);
        this._onMouseUp = this._onMouseUp.bind(this);
        this._onMouseWheel = this._onMouseWheel.bind(this);
        this._onKeyDown = this._onKeyDown.bind(this);
        this._onKeyUp = this._onKeyUp.bind(this);
        this._onHashChange = this._onHashChange.bind(this);

        window.addEventListener( "blur", self._onBlur, { passive: false } );
        canvas.addEventListener( "mousedown", self._onMouseDown, { passive: true } );
        canvas.addEventListener( "mousemove", self._onMouseMove, { passive: true } );
        document.addEventListener( "mousemove", self._onMouseMove, { capture: true } );
        canvas.addEventListener( "mouseup", self._onMouseUp, { passive: true } );
        document.addEventListener( "mouseup", self._onMouseUp, { capture: false } );
        canvas.addEventListener( "wheel", self._onMouseWheel, { passive : false } );
        canvas.addEventListener( "keydown", self._onKeyDown, { capture: false, passive: false } );
        canvas.addEventListener( "keyup", self._onKeyUp, { passive: true } );
        window.addEventListener("hashchange", self._onHashChange, { passive: false } );
    }

    /**
     * イベントリスナーの削除
     */
    private _removeEventListener()
    {
        // @ts-ignore
        var canvas = this._viewer._canvas_element;
        var self = this;
        // @ts-ignore
        window.removeEventListener( "blur", self._onBlur, { passive: false } );
        // @ts-ignore
        canvas.removeEventListener( "mousedown", self._onMouseDown, { passive: true } );
        // @ts-ignore
        canvas.removeEventListener( "mousemove", self._onMouseMove, { passive: true } );
        // @ts-ignore
        document.removeEventListener( "mousemove", self._onMouseMove, { capture: true } );
        // @ts-ignore
        canvas.removeEventListener( "mouseup", self._onMouseUp, { passive: true } );
        // @ts-ignore
        document.removeEventListener( "mouseup", self._onMouseUp, { capture: false } );
        // @ts-ignore
        canvas.removeEventListener( "wheel", self._onMouseWheel, { passive : false } );
        // @ts-ignore
        canvas.removeEventListener( "keydown", self._onKeyDown, { capture: false, passive: false } );
        // @ts-ignore
        canvas.removeEventListener( "keyup", self._onKeyUp, { passive: true } );
        // @ts-ignore
        window.removeEventListener( "hashchange", self._onHashChange, { passive: false } );
    }


    /**
     * レンダリングループ開始の処理
     */
    override onStart()
    {

    }

    /**
     * レンダリングループ終了の処理
     */
    override onStop()
    {

    }

    /**
     * フレームレンダリング前の処理
     *
     * - 値の計算
     *   - [[updateTranslation]]：longitude, latitude, heightの計算
     *   - [[updateRotation]]：roll, pitch, yawの計算
     * - 値の適用
     *   - [[updateClipPlane]]：near, farの更新
     *   - [[updateCamera]]：カメラ姿勢を
     *
     * ただし、フライカメラが動作している間は上記処理は停止されます。
     *
     * @param delta_time  全フレームからの経過時間（秒）
     */
    override onUpdateFrame( delta_time: number )
    {
        if (this._viewerCameraMode === StandardUIViewer.CameraMode.CAMERA_FLY) {
            this.updateFlyCamera( delta_time );

        } else {
            if ( this._controllable ) {
                // 平行移動
                this.updateTranslation( delta_time );

                // 回転
                this.updateRotation( delta_time );

                // 自由回転
                this._freeRotation( delta_time )

                // 高さ変更
                this.updateTranslationOfHeight();

                //　視線方向移動
                this.updateTranslationOfEyeDirection();
            }

            // 画角変更
            this._changeFovy();

            // 高度補正
            this._correctAltitude();

            // クリップ範囲の更新
            this.updateClipPlane();

            // カメラ姿勢の確定
            this.updateCamera();
        }
    }

    /**
     * カメラの位置・向きの更新
     */
    protected updateCamera()
    {
        var camera = this.viewer.camera;

        var camera_geoPoint = new GeoPoint( this._camera_parameter.longitude, this._camera_parameter. latitude, this._camera_parameter.height );
        var camera_matrix = camera_geoPoint.getMlocsToGocsMatrix( GeoMath.createMatrix() );

        var pitch_matrix = GeoMath.rotation_matrix( [1, 0, 0], this._camera_parameter.pitch, GeoMath.createMatrix() );
        var yaw_matrix = GeoMath.rotation_matrix( [0, 0, 1], this._camera_parameter.yaw, GeoMath.createMatrix() );
        var eye_matrix = GeoMath.mul_AA( yaw_matrix, pitch_matrix, GeoMath.createMatrix() );

        camera.view_to_gocs = GeoMath.mul_AA( camera_matrix, eye_matrix, GeoMath.createMatrix() );

        camera.fov = this._camera_parameter.fov;

        camera.near = this._camera_parameter.near;
        camera.far = this._camera_parameter.far;

        // URL書き換え
        this._updateURLHash();
    }


    /**
     * URLHashの更新
     */
    private _updateURLHash(): void
    {
      if ( this._selfHashChangeFlag || !this._update_url_hash || this._operation_mode !== StandardUIViewer.OperationMode.NONE ) {
          return;
      }
      const changed = (
          ( this._last_camera_parameter.latitude !== this._camera_parameter.latitude ) ||
          ( this._last_camera_parameter.longitude !== this._camera_parameter.longitude ) ||
          ( this._last_camera_parameter.height !== this._camera_parameter.height ) ||
          ( this._last_camera_parameter.pitch !== this._camera_parameter.pitch ) ||
          ( this._last_camera_parameter.yaw !== this._camera_parameter.yaw )
      );
      if ( changed ) {
          const new_hash = this.createCameraParameterHash();
          if ( new_hash ) {
              this._last_camera_parameter.latitude = this._camera_parameter.latitude;
              this._last_camera_parameter.longitude = this._camera_parameter.longitude;
              this._last_camera_parameter.height = this._camera_parameter.height;
              this._last_camera_parameter.pitch = this._camera_parameter.pitch;
              this._last_camera_parameter.yaw = this._camera_parameter.yaw;

              this._selfHashChangeFlag = true;
              const new_url = window.location.href.replace( window.location.hash, new_hash );
              window.location.replace( new_url );
          }
      }
    }


    /**
     * 現在のカメラ情報から URL Hash string を取得
     * @returns Hash Stringが生成できないときは length 0の文字列
     */
    createCameraParameterHash(): string | undefined
    {
        const viewer = this.viewer;

        // 注視点
        // 画面中央を移動基準にする
        const canvas = viewer.canvas_element;
        const center_position = GeoMath.createVector2([canvas.width / 2, canvas.height / 2]);

        // レイと地表の交点を求める
        const ray = viewer.camera.getCanvasRay( center_position, new mapray.Ray() );
        const cross_point = viewer.getRayIntersection( ray );
        if ( !cross_point ) {
            return undefined;
        }
        const cross_geoPoint = new mapray.GeoPoint();
        cross_geoPoint.setFromGocs( cross_point );
        cross_geoPoint.altitude = viewer.getElevation( cross_geoPoint.latitude, cross_geoPoint.longitude );
        cross_geoPoint.getAsGocs( cross_point );

        // カメラ位置と交点の距離を求める
        const camera = viewer.camera;
        const length = GeoMath.length3(GeoMath.createVector3([
              camera.view_to_gocs[12] - cross_point[0],
              camera.view_to_gocs[13] - cross_point[1],
              camera.view_to_gocs[14] - cross_point[2],
        ]));

        // URLの生成
        const lat = cross_geoPoint.latitude;
        const lon = cross_geoPoint.longitude;
        const alt = cross_geoPoint.altitude;
        const tilt = this._camera_parameter.pitch;
        const range = length;
        const heading = this._camera_parameter.yaw;
        return "#" + (
          this._update_url_hash_full_digits ? (
            lat + "/" + lon + "/" + alt + "a/" +
            tilt + "t/" + range + "r/" + heading + "h"
          ):
          (
            lat.toFixed(10) + "/" + lon.toFixed(10) + "/" + alt.toFixed(5) + "a/" +
            tilt.toFixed(5) + "t/" + range.toFixed(5) + "r/" + heading.toFixed(5) + "h"
          )
        );
    }


    /**
     * クリップ範囲の更新
     */
    protected updateClipPlane()
    {
        const viewer = this._viewer;
        if ( !viewer ) return;

        // 地表面の標高
        var elevation = viewer.getElevation( this._camera_parameter.latitude, this._camera_parameter.longitude );
        var altitude = GeoMath.clamp( this._camera_parameter.height - elevation, this._altitude_range.min, this._altitude_range.max );

        this._camera_parameter.near = Math.max( altitude * StandardUIViewer.NEAR_FACTOR, StandardUIViewer.MINIMUM_NEAR );
        this._camera_parameter.far = Math.max( this._camera_parameter.near * StandardUIViewer.FAR_FACTOR, StandardUIViewer.MINIMUM_FAR );
    }

    /**
     * 高度の補正（地表面以下にならないようにする）
     */
    private _correctAltitude()
    {
        const viewer = this._viewer;
        if ( !viewer ) return;

        var elevation = viewer.getElevation( this._camera_parameter.latitude, this._camera_parameter.longitude );
        this._camera_parameter.height = GeoMath.clamp( this._camera_parameter.height, elevation + this._altitude_range.min, elevation + this._altitude_range.max );
    }

    /**
     * @internal
     * カメラ高度の移動可能範囲を指定します。
     * @param min 下限
     * @param max 上限（省略可）
     */
    setCameraAltitudeRange( min: number, max?: number ): void
    {
        if ( max !== undefined ) {
            if ( min > max ) throw new Error("Illegal Argument");
        }
        this._altitude_range.min = min;
        this._altitude_range.max = max || Number.MAX_VALUE;
        this._correctAltitude();
    }

    /**
     * 操作系のイベントをリセットする(公開関数)
     */
    resetOpEvent()
    {
        this._resetEventParameter();
    }

    /**
     * フォーカスが外れた時のイベント(公開関数)
     *
     * @param event  イベントデータ
     */
    onBlur( event: Event )
    {
        this._resetEventParameter();
    }

    /**
     * フォーカスが外れた時のイベント
     *
     * @param event  イベントデータ
     */
    private _onBlur( event: Event )
    {
        this.onBlur( event );
    }

    /**
     * マウスを押した時のイベント(公開関数）
     *
     * @param point 要素上の座標
     * @param event  マウスイベントデータ
     */
    onMouseDown( point: [x: number, y: number], event: MouseEvent )
    {
        const viewer = this._viewer;
        if ( !viewer ) return;

        this._mouse_down_position = point;
        this._pre_mouse_position = point;

        // 左ボタン
        if ( event.button === 0 )
        {
            if ( event.shiftKey )
            {
                this._operation_mode = StandardUIViewer.OperationMode.ROTATE;

                var camera = viewer.camera;
                var ray = camera.getCanvasRay( this._mouse_down_position );
                this._rotate_center = viewer.getRayIntersection( ray ) as mapray.Vector3 | null;
            }
            else if ( event.ctrlKey )
            {
                this._operation_mode = StandardUIViewer.OperationMode.FREE_ROTATE;
            }
            else
            {
                this._operation_mode = StandardUIViewer.OperationMode.TRANSLATE;
            }
        }
        // 中ボタン
        else if ( event.button === 1 )
        {
            this._operation_mode = StandardUIViewer.OperationMode.ROTATE;

            var camera = viewer.camera;
            var ray = camera.getCanvasRay( this._mouse_down_position );
            this._rotate_center = viewer.getRayIntersection( ray ) as mapray.Vector3 | null;
        }
        // 右ボタン
        else if ( event.button === 2 )
        {
            this._operation_mode = (
                event.shiftKey ? StandardUIViewer.OperationMode.HEIGHT_TRANSLATE:
                    StandardUIViewer.OperationMode.EYE_TRANSLATE
            );
        }
    }

    /**
     * マウスを押した時のイベント
     *
     * @param event  マウスイベントデータ
     */
    private _onMouseDown( event: MouseEvent )
    {
        const viewer = this._viewer;
        if ( !viewer ) return;

        const point = this._mousePos( viewer.canvas_element, event );
        this.onMouseDown( point, event );
    }

    /**
     * マウスを動かした時のイベント（公開間数）
     *
     * @param point 要素上の座標
     * @param event  マウスイベントデータ
     */
    onMouseMove( point: [ x: number, y: number ], event: MouseEvent )
    {
        var mouse_position = point;

        //　平行移動
        if ( this._operation_mode === StandardUIViewer.OperationMode.TRANSLATE )
        {
            this._translate_drag[0] += mouse_position[0] - this._pre_mouse_position[0];
            this._translate_drag[1] += mouse_position[1] - this._pre_mouse_position[1];
        }
        //　回転移動
        else if ( this._operation_mode === StandardUIViewer.OperationMode.ROTATE )
        {
            this._rotate_drag[0] += mouse_position[0] - this._pre_mouse_position[0];
            this._rotate_drag[1] += mouse_position[1] - this._pre_mouse_position[1];
        }
        else if ( this._operation_mode === StandardUIViewer.OperationMode.FREE_ROTATE )
        {
            this._free_rotate_drag[0] += mouse_position[0] - this._pre_mouse_position[0];
            this._free_rotate_drag[1] += mouse_position[1] - this._pre_mouse_position[1];
        }
        // 高度変更
        else if ( this._operation_mode === StandardUIViewer.OperationMode.HEIGHT_TRANSLATE )
        {
            // 横方向は平行移動する
            this._translate_drag[0] += mouse_position[0] - this._pre_mouse_position[0];
            this._height_drag[1] += mouse_position[1] - this._pre_mouse_position[1];
        }
        else if ( this._operation_mode === StandardUIViewer.OperationMode.EYE_TRANSLATE )
        {
            this._translate_eye_drag[1] += mouse_position[1] - this._pre_mouse_position[1];
        }

        // マウス位置の更新
        this._pre_mouse_position = mouse_position;

    }

    /**
     * マウスを動かした時のイベント
     *
     * @param event  マウスイベントデータ
     */
    private _onMouseMove( event: MouseEvent )
    {
        const viewer = this._viewer;
        if ( !viewer ) return;

        const point = this._mousePos( viewer.canvas_element, event );
        this.onMouseMove( point, event );
    }

    /**
     * マウスを上げた時のイベント（公開関数）
     *
     * @param point 要素上の座標
     * @param event  マウスイベントデータ
     */
    onMouseUp( point: [ x: number, y: number ], event: MouseEvent )
    {
        this._resetEventParameter();
    }

    /**
     * マウスを上げた時のイベント
     *
     * @param  event  マウスイベントデータ
     */
    private _onMouseUp( event: MouseEvent )
    {
        const viewer = this._viewer;
        if ( !viewer ) return;

        const point = this._mousePos( viewer.canvas_element, event );
        this.onMouseUp( point, event );
    }

    /**
     * マウスホイールを動かした時のイベント
     *
     * @param point 要素上の座標
     * @param event ホイールイベント
     */
    onMouseWheel( point: [ x: number, y: number ], event: WheelEvent )
    {
        event.preventDefault();

        if (this._viewerCameraMode != StandardUIViewer.CameraMode.CAMERA_FREE) {
            return;
        }

        this._mouse_down_position = point;

        var zoom = 0;

        zoom = -1 * Math.sign( event.deltaY ) * Math.ceil( Math.abs( event.deltaY ) / 100 );

        this._zoom_wheel += zoom;
    }

    /**
     * マウスホイールを動かした時のイベント
     */
    private _onMouseWheel( event: WheelEvent )
    {
        const viewer = this._viewer;
        if ( !viewer ) return;

        const point = this._mousePos( viewer.canvas_element, event );
        this.onMouseWheel( point, event );
    }

    /**
     * キーを押した時のイベント(公開関数)
     */
    onKeyDown( event: KeyboardEvent )
    {
        switch( event.key )
        {
            // [c] 画角の拡大
            case "c":
            case "C":
                this._operation_mode = StandardUIViewer.OperationMode.CHANGE_FOVY;
                this._fovy_key = 1;
                break;

            // [z] 画角の縮小
            case "z":
            case "Z":
                this._operation_mode = StandardUIViewer.OperationMode.CHANGE_FOVY;
                this._fovy_key = -1;
                break;

            // [x] 画角の初期化
            case "x":
            case "X":
                this._camera_parameter.fov = this._default_fov
                break;

            // ↑ 前進
            case "ArrowUp": {
                event.preventDefault();
                const viewer = this._viewer;
                if ( !viewer ) return;

                // 画面中央を移動基準にする
                var canvas = viewer.canvas_element;
                var mouse_position = [canvas.width / 2, canvas.height / 2] as [ x: number, y: number ];
                this._mouse_down_position = mouse_position;

                this._translate_drag[1] = 100;
                this._key_mode = true;
            } break;

            // ↓ 後退
            case "ArrowDown": {
                event.preventDefault();
                const viewer = this._viewer;
                if ( !viewer ) return;

                // 画面中央を移動基準にする
                var canvas = viewer.canvas_element;
                var mouse_position = [canvas.width / 2, canvas.height / 2] as [ x: number, y: number ];
                this._mouse_down_position = mouse_position;

                this._translate_drag[1] = -100;
                this._key_mode = true;
            } break;

            // ← 左回転
            case "ArrowLeft":
                event.preventDefault();
                // 画面中央を移動基準にする
                this._free_rotate_drag[0] = 100;
                this._key_mode = true;
                break;

            case "ArrowRight":
                // 画面中央を移動基準にする
                event.preventDefault();
                this._free_rotate_drag[0] = -100;
                this._key_mode = true;
                break;
        }
    }

    /**
     * キーを押した時のイベント
     */
    private _onKeyDown( event: KeyboardEvent )
    {
        this.onKeyDown( event );
    }

    /**
     * キーを挙げた時のイベント(公開関数）
     */
    onKeyUp( event: KeyboardEvent )
    {
        switch ( event.key )
        {
            // [c] 画角の拡大
            case "c":
            case "C":
                this._operation_mode = StandardUIViewer.OperationMode.NONE;
                this._fovy_key = 0;
                break;

            // [z] 画角の縮小
            case "z":
            case "Z":
                this._operation_mode = StandardUIViewer.OperationMode.NONE;
                this._fovy_key = 0;
                break;

            // ↑ 前進
            case "ArrowUp":
                this._operation_mode = StandardUIViewer.OperationMode.NONE;
                this._translate_drag[1] = 0;

                this._key_mode = false;
                break;

            // ↓ 後退
            case "ArrowDown":
                this._operation_mode = StandardUIViewer.OperationMode.NONE;
                this._translate_drag[1] = 0;

                this._key_mode = false;
                break;

            // ← 左回転
            case "ArrowLeft":
                this._operation_mode = StandardUIViewer.OperationMode.NONE;
                this._free_rotate_drag[0] = 0;

                this._key_mode = false;
                break;

            case "ArrowRight":
                this._operation_mode = StandardUIViewer.OperationMode.NONE;
                this._free_rotate_drag[0] = 0;

                this._key_mode = false;
                break;
        }
    }

    /**
     * キーを挙げた時のイベント
     *
     * @param event
     */
    private _onKeyUp( event: KeyboardEvent )
    {
        this.onKeyUp( event );
    }

    /**
     * イベントパラメータの初期化
     */
    private _resetEventParameter()
    {
        this._translate_drag[0] = 0;
        this._translate_drag[1] = 0;

        this._rotate_drag[0] = 0;
        this._rotate_drag[1] = 0;

        this._free_rotate_drag[0] = 0;
        this._free_rotate_drag[1] = 0;

        this._height_drag[0] = 0;
        this._height_drag[1] = 0;

        this._operation_mode = StandardUIViewer.OperationMode.NONE;
    }


    /**
     * カメラの平行移動
     */
    protected updateTranslation( delta_time: number )
    {
        const viewer = this._viewer;
        if ( !viewer ) return;

        if ( this._translate_drag[0] != 0 || this._translate_drag[1] != 0 )
        {
            if ( this._key_mode )
            {
                this._translate_drag[0] *= delta_time;
                this._translate_drag[1] *= delta_time;
            }

            var camera = viewer.camera;

            var ray = camera.getCanvasRay( this._mouse_down_position );
            var start_position = viewer.getRayIntersection( ray ) as mapray.Vector3 | null;

            var end_mouse_position = GeoMath.createVector2([this._mouse_down_position[0] + this._translate_drag[0], this._mouse_down_position[1] + this._translate_drag[1]]);
            ray = camera.getCanvasRay( end_mouse_position );
            var end_position = viewer.getRayIntersection( ray ) as mapray.Vector3 | null;

            if ( start_position == null || end_position == null )
            {
                return;
            }

            var start_spherical_position = new mapray.GeoPoint();
            start_spherical_position.setFromGocs( start_position );

            var end_spherical_position = new mapray.GeoPoint();
            end_spherical_position.setFromGocs( end_position );

            // 球とレイの交点計算
            var variable_A = Math.pow( this._getVectorLength( ray.direction ), 2 );
            var variable_B = 2 * GeoMath.dot3( ray.position, ray.direction );
            var variable_C = Math.pow( this._getVectorLength( ray.position ), 2 ) - Math.pow( start_spherical_position.altitude + GeoMath.EARTH_RADIUS, 2 );
            var variable_D = variable_B * variable_B - 4 * variable_A * variable_C;

            // カメラより選択した場所の高度が高い、交点が取れない場合は補正しない
            if ( start_spherical_position.altitude < this._camera_parameter.height &&
                 end_spherical_position.altitude < this._camera_parameter.height &&
                 variable_D > 0 )
            {
                var variable_t1 = ( -variable_B + Math.sqrt( variable_D ) ) / 2 * variable_A;
                var variable_t2 = ( -variable_B - Math.sqrt( variable_D ) ) / 2 * variable_A;

                var variable_t = Math.min( variable_t1, variable_t2 )

                end_position[0] = ray.position[0] + variable_t * ray.direction[0];
                end_position[1] = ray.position[1] + variable_t * ray.direction[1];
                end_position[2] = ray.position[2] + variable_t * ray.direction[2];

                end_spherical_position.setFromGocs( end_position );
            }

            var delta_latitude = end_spherical_position.latitude - start_spherical_position.latitude;
            var delta_longitude = end_spherical_position.longitude - start_spherical_position.longitude;

            this._camera_parameter.latitude -= delta_latitude;
            this._camera_parameter.longitude -= delta_longitude;

            this._translate_drag[0] = 0;
            this._translate_drag[1] = 0;

            // マウスダウンの位置を更新する
            this._mouse_down_position = this._pre_mouse_position
        }
    }

    /**
     * カメラの回転（回転中心指定）
     */
    protected updateRotation( delta_time: number )
    {
        const viewer = this._viewer;
        if ( !viewer ) return;

        if ( this._rotate_drag[0] != 0 || this._rotate_drag[1] != 0 )
        {
            if (this._rotate_center == null)
            {
                this._rotate_drag[0] = 0;
                this._rotate_drag[1] = 0;

                return;
            }

            var camera = viewer.camera;

            var camera_direction = GeoMath.createVector3();
            camera_direction[0] = camera.view_to_gocs[12] - this._rotate_center[0];
            camera_direction[1] = camera.view_to_gocs[13] - this._rotate_center[1];
            camera_direction[2] = camera.view_to_gocs[14] - this._rotate_center[2];

            var center_geoPoint = new mapray.GeoPoint();
            center_geoPoint.setFromGocs( this._rotate_center );
            var center_matrix = center_geoPoint.getMlocsToGocsMatrix( GeoMath.createMatrix() );

            var rotate_axis = GeoMath.createVector3();
            rotate_axis[0] = center_matrix[8];
            rotate_axis[1] = center_matrix[9];
            rotate_axis[2] = center_matrix[10];

            rotate_axis = GeoMath.normalize3( rotate_axis, GeoMath.createVector3() );

            // カメラ自身を回転
            var yaw_angle = -this._rotate_drag[0] / 10;
            var pitch_angle = -this._rotate_drag[1] / 10;

            var rotated_direction = this.rotateVector( camera_direction, rotate_axis, yaw_angle );

            var after_pitch = GeoMath.clamp( this._camera_parameter.pitch + pitch_angle, 0, 90 );

            if ( after_pitch != this._camera_parameter.pitch )
            {
                rotate_axis[0] = camera.view_to_gocs[0];
                rotate_axis[1] = camera.view_to_gocs[1];
                rotate_axis[2] = camera.view_to_gocs[2];

                rotated_direction = this.rotateVector( rotated_direction, rotate_axis, pitch_angle );
            }

            var new_position = GeoMath.createVector3();
            new_position[0] = this._rotate_center[0] + rotated_direction[0];
            new_position[1] = this._rotate_center[1] + rotated_direction[1];
            new_position[2] = this._rotate_center[2] + rotated_direction[2];

            var new_spherical_position = new mapray.GeoPoint();
            new_spherical_position.setFromGocs( new_position );

            this._camera_parameter.latitude = new_spherical_position.latitude;
            this._camera_parameter.longitude = new_spherical_position.longitude;
            this._camera_parameter.height = new_spherical_position.altitude;
            this._camera_parameter.yaw += yaw_angle;
            this._camera_parameter.pitch = after_pitch;

            this._rotate_drag[0] = 0;
            this._rotate_drag[1] = 0;
        }
    }

    /**
     * カメラの回転（自由回転）
     */
    private _freeRotation( delta_time: number )
    {
        if ( this._free_rotate_drag[0] != 0 || this._free_rotate_drag[1] != 0 )
        {
            if ( this._key_mode )
            {
                this._free_rotate_drag[0] *= delta_time;
                this._free_rotate_drag[1] *= delta_time;
            }

            // カメラ自身を回転
            var yaw_angle = this._free_rotate_drag[0] / 10;
            var pitch_angle = this._free_rotate_drag[1] / 10;

            var after_pitch = GeoMath.clamp( this._camera_parameter.pitch + pitch_angle, 0, 90 );

            this._camera_parameter.yaw += yaw_angle;
            this._camera_parameter.pitch = after_pitch;

            this._free_rotate_drag[0] = 0;
            this._free_rotate_drag[1] = 0;
        }
    }

    /**
     * 高度変更
     */
    protected updateTranslationOfHeight()
    {
        if ( this._height_drag[0] != 0 || this._height_drag[1] != 0 )
        {
            var height_drag = this._height_drag[1];

            var factor = GeoMath.gudermannian( ( this._camera_parameter.height - 50000 ) / 10000 ) + Math.PI / 2;
            var delta_height = height_drag * 100 * factor;

            this._camera_parameter.height += delta_height;

            this._height_drag[0] = 0;
            this._height_drag[1] = 0;
        }
    }

    /**
     * 視線方向への移動
     */
    protected updateTranslationOfEyeDirection()
    {
        const viewer = this._viewer;
        if ( !viewer ) return;

        let zoom = 0;
        if ( this._zoom_wheel != 0 )
        {
            zoom = Math.pow(0.9, this._zoom_wheel);
            this._zoom_wheel = 0;
        }
        else if ( this._translate_eye_drag[1] != 0 ) {
            zoom = Math.pow(0.995, this._translate_eye_drag[1]);
            this._translate_eye_drag[1] = 0;
        }

        if ( zoom !== 0 )
        {
            var camera = viewer.camera;

            // 移動中心
            var ray = camera.getCanvasRay( this._mouse_down_position );
            var translation_center = viewer.getRayIntersection( ray ) as mapray.Vector3 | null;

            if (translation_center == null)
            {
                return;
            }

            var center_spherical_position = new mapray.GeoPoint();
            center_spherical_position.setFromGocs( translation_center );

            var translation_vector = GeoMath.createVector3();
            translation_vector[0] = (translation_center[0] - camera.view_to_gocs[12]) * zoom;
            translation_vector[1] = (translation_center[1] - camera.view_to_gocs[13]) * zoom;
            translation_vector[2] = (translation_center[2] - camera.view_to_gocs[14]) * zoom;

            var new_camera_gocs_position = GeoMath.createVector3();
            new_camera_gocs_position[0] = translation_center[0] - translation_vector[0];
            new_camera_gocs_position[1] = translation_center[1] - translation_vector[1];
            new_camera_gocs_position[2] = translation_center[2] - translation_vector[2];

            var new_camera_spherical_position = new mapray.GeoPoint();
            new_camera_spherical_position.setFromGocs( new_camera_gocs_position );

            const elevation = viewer.getElevation( new_camera_spherical_position.latitude, new_camera_spherical_position.longitude );
            const clamp_pos = (
                (elevation + this._altitude_range.min) > new_camera_spherical_position.altitude ? elevation + this._altitude_range.min:
                (elevation + this._altitude_range.max) < new_camera_spherical_position.altitude ? elevation + this._altitude_range.max:
                undefined
            );

            if ( clamp_pos ) {
                // fix_altitude だけ高さを変更する。
                const fix_altitude = new_camera_spherical_position.altitude - clamp_pos;
                const up = center_spherical_position.getUpwardVector(GeoMath.createVector3());
                const translation_vector_length = Math.sqrt(
                  translation_vector[0] * translation_vector[0] +
                  translation_vector[1] * translation_vector[1] +
                  translation_vector[2] * translation_vector[2]
                );
                const up_dot_dir = GeoMath.dot3(translation_vector, up) / translation_vector_length;
                GeoMath.scale3(1 - (fix_altitude / up_dot_dir / translation_vector_length), translation_vector, translation_vector);

                new_camera_gocs_position[0] = translation_center[0] - translation_vector[0];
                new_camera_gocs_position[1] = translation_center[1] - translation_vector[1];
                new_camera_gocs_position[2] = translation_center[2] - translation_vector[2];
                new_camera_spherical_position.setFromGocs( new_camera_gocs_position );
            }
            this._camera_parameter.latitude = new_camera_spherical_position.latitude;
            this._camera_parameter.longitude = new_camera_spherical_position.longitude;
            this._camera_parameter.height = new_camera_spherical_position.altitude;

            this._zoom_wheel = 0;
        }
    }

    /**
     * 画角変更
     */
    private _changeFovy()
    {
        var tanθh = Math.tan( 0.5 * this._camera_parameter.fov * GeoMath.DEGREE );
        var θ = 2 * Math.atan( tanθh * Math.pow( StandardUIViewer.FOV_FACTOR, -this._fovy_key ) );
        var range = StandardUIViewer.FOV_RANGE;
        this._camera_parameter.fov = GeoMath.clamp( θ / GeoMath.DEGREE, range.min, range.max );

        this._fovy_key = 0;
    }


    /**
     * カメラ位置の取得
     */
    getCameraPosition(): mapray.GeoPointData
    {
        const parameter = this._camera_parameter;
        return {
            longitude: parameter.longitude,
            latitude: parameter.latitude,
            height: parameter.height,
        };
    }


    /**
     * カメラ位置の設定
     *
     * @param position            カメラ位置
     */
    setCameraPosition( position: mapray.GeoPointData )
    {
        this._camera_parameter.latitude = position.latitude;
        this._camera_parameter.longitude = position.longitude;
        this._camera_parameter.height = position.height;

        // 最低高度補正
        this._camera_parameter.height = GeoMath.clamp( this._camera_parameter.height, this._altitude_range.min, this._altitude_range.max );
    }



    /**
     * カメラ方向の取得
     */
    getCameraAngle(): StandardUIViewer.RollPitchYawData
    {
        const parameter = this._camera_parameter;
        return {
            roll: parameter.roll,
            pitch: parameter.pitch,
            yaw: parameter.yaw,
        };
    }

    /**
     * カメラ方向の設定
     */
    setCameraAngle( angle: StandardUIViewer.RollPitchYawData ): void
    {
        const parameter = this._camera_parameter;
        parameter.roll = angle.roll;
        parameter.pitch = angle.pitch;
        parameter.yaw = angle.yaw;
    }




    /**
     * 閾値のある同一判定
     *
     * @param  value1 値1
     * @param  value1 値2
     * @param  threshold 閾値
     * @returns 判定結果
     */
    private _isSame( value1: number, value2: number, threshold: number = 0.000001 ): boolean
    {
        let threshold_value = threshold;
        if((Math.abs(value1 - value2)) < threshold_value) {
            return true;
        }
        return false;
    }

    /**
     * 注視点の設定
     *
     * @param position カメラ位置
     * @param yaw      ヨー角
     */
    setLookAtPosition( position: mapray.GeoPointData, yaw: number = 0 )
    {
        if( this._isSame(this._camera_parameter.longitude, position.longitude) &&
            this._isSame(this._camera_parameter.latitude, position.latitude) ) {
            this._camera_parameter.yaw = yaw;
            this._camera_parameter.pitch = 0;
            return;
        }

        // 現在の視線方向を取得
        var current_camera_geoPoint = new GeoPoint( this._camera_parameter.longitude, this._camera_parameter.latitude, this._camera_parameter.height );
        var current_camera_matrix = current_camera_geoPoint.getMlocsToGocsMatrix( GeoMath.createMatrix() );

        var current_y_direction = GeoMath.createVector3();
        current_y_direction[0] = current_camera_matrix[4];
        current_y_direction[1] = current_camera_matrix[5];
        current_y_direction[2] = current_camera_matrix[6];

        var target_camera_geoPoint = new GeoPoint( position.longitude, position.latitude, position.height );
        var target_camera_matrix = target_camera_geoPoint.getMlocsToGocsMatrix( GeoMath.createMatrix() );
        var target_camera_direction = GeoMath.createVector3();
        target_camera_direction[0] = target_camera_matrix[12] - current_camera_matrix[12];
        target_camera_direction[1] = target_camera_matrix[13] - current_camera_matrix[13];
        target_camera_direction[2] = target_camera_matrix[14] - current_camera_matrix[14];

        current_y_direction = GeoMath.normalize3( current_y_direction, GeoMath.createVector3() );
        target_camera_direction = GeoMath.normalize3( target_camera_direction, GeoMath.createVector3() );

        var rotate_axis = GeoMath.createVector3();
        rotate_axis[0] = current_camera_matrix[8];
        rotate_axis[1] = current_camera_matrix[9];
        rotate_axis[2] = current_camera_matrix[10];

        var yaw_angle = this.calculateAngle( rotate_axis, current_y_direction, target_camera_direction );
        this._camera_parameter.yaw = yaw_angle;

        var current_camera_direction = GeoMath.createVector3();
        current_camera_direction[0] = current_camera_matrix[8];
        current_camera_direction[1] = current_camera_matrix[9];
        current_camera_direction[2] = current_camera_matrix[10];

        var pitch_axis = GeoMath.createVector3();
        pitch_axis[0] = current_camera_matrix[0];
        pitch_axis[1] = current_camera_matrix[1];
        pitch_axis[2] = current_camera_matrix[2];
        rotate_axis = this.rotateVector( pitch_axis, rotate_axis, yaw_angle );

        target_camera_direction[0] = -1 * target_camera_direction[0];
        target_camera_direction[1] = -1 * target_camera_direction[1];
        target_camera_direction[2] = -1 * target_camera_direction[2];

        this._camera_parameter.pitch = GeoMath.clamp( Math.abs( this.calculateAngle( rotate_axis, current_camera_direction, target_camera_direction ) ), 0, 90 );
    }



    /**
     * カメラパラメータの取得
     */
    getCameraParameter(): StandardUIViewer.CameraParameter
    {
        const parameter = this._camera_parameter;
        return {
            fov: parameter.fov,
            near: parameter.near,
            far: parameter.far,
            speed_factor: parameter.speed_factor,
        };
    }



    /**
     * カメラパラメータの設定
     *
     * @param parameter  カメラパラメータ
     */
    setCameraParameter( parameter: StandardUIViewer.CameraParameterOption )
    {
        if ( parameter.fov ) {
            this._camera_parameter.fov = parameter.fov;
            this._default_fov = parameter.fov;
        }

        if ( parameter.near ) { this._camera_parameter.near = parameter.near; }
        if ( parameter.far ) { this._camera_parameter.far = parameter.far; }
        if ( parameter.speed_factor ) { this._camera_parameter.speed_factor = parameter.speed_factor; }
    }



    /**
     * レイヤの取得
     *
     * @param index  レイヤ番号
     * @returns      レイヤ
     */
    getLayer( index: number ): mapray.Layer
    {
        // @ts-ignore
        const viewer = this._viewer as mapray.Viewer;
        return viewer.layers.getLayer( index );
    }

    /**
     * レイヤ数の取得
     *
     * @returns レイヤ数
     */
    getLayerNum(): number
    {
        const viewer = this._viewer as mapray.Viewer;
        return viewer.layers.num_layers;
    }

    /**
     * レイヤの追加（末尾）
     *
     * @param layer                  作成するレイヤのプロパティ
     */
    addLayer( layer: any )
    {
        const viewer = this._viewer as mapray.Viewer;
        viewer.layers.add( layer );
    }

    /**
     * レイヤの追加（任意）
     *
     * @param index                  挿入場所
     * @param layer                  作成するレイヤのプロパティ
     */
    insertLayer( index: number, layer: any )
    {
        const viewer = this._viewer as mapray.Viewer;
        viewer.layers.insert( index, layer );
    }

    /**
     * レイヤの削除
     *
     * @param index    レイヤ番号
     */
    removeLayer( index: number )
    {
        const viewer = this._viewer as mapray.Viewer;
        viewer.layers.remove( index );
    }

    /**
     * レイヤの全削除
     */
    clearLayer()
    {
        const viewer = this._viewer as mapray.Viewer;
        viewer.layers.clear();
    }

    /**
     * エンティティの取得
     *
     * @param index エンティティ番号
     * @returns     エンティティ
     */
    getEntity( index: number ): mapray.Entity
    {
        const viewer = this._viewer as mapray.Viewer;
        return viewer.scene.getEntity( index );
    }

    /**
     * エンティティ数の取得
     *
     * @returns    エンティティ数
     */
    getEntityNum(): number
    {
        const viewer = this._viewer as mapray.Viewer;
        return viewer.scene.num_entities;
    }

    /**
     * エンティティの追加
     *
     * @param entity    エンティティ
     */
    addEntity( entity: mapray.Entity )
    {
        const viewer = this._viewer as mapray.Viewer;
        viewer.scene.addEntity( entity );
    }

    /**
     * エンティティの削除
     *
     * @param entity    エンティティ
     */
    removeEntity( entity: mapray.Entity )
    {
        const viewer = this._viewer as mapray.Viewer;
        viewer.scene.removeEntity( entity );
    }

    /**
     * エンティティの全削除
     */
    clearEntities()
    {
        const viewer = this._viewer as mapray.Viewer;
        viewer.scene.clearEntities();
    }

    /**
     * 3次元ベクトルの長さの算出
     * @param vector 対象ベクトル
     * @returns      長さ
     */
    private _getVectorLength( vector: mapray.Vector3 ): number
    {
        return Math.sqrt( Math.pow( vector[0], 2 ) + Math.pow( vector[1], 2 ) + Math.pow( vector[2], 2 ) );
    }

    /**
     * 3次元ベクトルの任意軸の回転
     *
     * @param vector   対象ベクトル
     * @param axis     回転軸
     * @param angle    回転角度（deg.）
     * @returns        回転後ベクトル
     */
    protected rotateVector( vector: mapray.Vector3, axis: mapray.Vector3, angle: number ): mapray.Vector3
    {
        var rotate_matrix = GeoMath.rotation_matrix( axis, angle, GeoMath.createMatrix() );

        var target_vector = GeoMath.createVector3();
        target_vector[0] = vector[0] * rotate_matrix[0] + vector[1] * rotate_matrix[4] + vector[2] * rotate_matrix[8] + rotate_matrix[12];
        target_vector[1] = vector[0] * rotate_matrix[1] + vector[1] * rotate_matrix[5] + vector[2] * rotate_matrix[9] + rotate_matrix[13];
        target_vector[2] = vector[0] * rotate_matrix[2] + vector[1] * rotate_matrix[6] + vector[2] * rotate_matrix[10] + rotate_matrix[14];

        return target_vector;
    }

    /**
     * 任意軸回りの回転角度の算出
     *
     * @param axis          回転軸
     * @param basis_vector  基準ベクトル
     * @param target_vector 目標ベクトル
     * @returns             回転角度（deg.）
     */
    protected calculateAngle( axis: mapray.Vector3, basis_vector: mapray.Vector3, target_vector: mapray.Vector3 ): number
    {
        var a_vector = GeoMath.createVector3();
        var dot_value = GeoMath.dot3( axis, basis_vector );

        for ( var i = 0; i < 3; i++ )
        {
            a_vector[i] = basis_vector[i] - dot_value * axis[i];
        }

        var b_vector = GeoMath.createVector3();
        dot_value = GeoMath.dot3( axis, target_vector );

        for ( var i = 0; i < 3; i++ )
        {
            b_vector[i] = target_vector[i] - dot_value * axis[i];
        }

        GeoMath.normalize3( a_vector, a_vector );
        GeoMath.normalize3( b_vector, b_vector );

        const flag = (
            Math.abs( this._getVectorLength( a_vector ) ) < 1.0e-6 ||
            Math.abs( this._getVectorLength( b_vector ) ) < 1.0e-6
        );
        if ( flag ) {
            angle = 0;
        }
        else {
            var angle = Math.acos( GeoMath.clamp( GeoMath.dot3( a_vector, b_vector ) / ( this._getVectorLength( a_vector ) * this._getVectorLength( b_vector ) ), -1, 1 ) ) / GeoMath.DEGREE;

            var cross_vector = GeoMath.cross3( a_vector, b_vector, GeoMath.createVector3() );
            cross_vector = GeoMath.normalize3( cross_vector, GeoMath.createVector3() );

            if ( GeoMath.dot3( axis, cross_vector ) < 0 )
            {
                angle *= -1;
            }
        }

        return angle;
    }

    /**
     * 要素上での座標を取得
     *
     * @param el     HTMLElement
     * @param event  イベントオブジェクト
     * @returns      要素(el)の上での座標
     */
    private _mousePos( el: HTMLElement, event: MouseEvent ): [ x: number, y: number ] {
        const rect = el.getBoundingClientRect();
        return [
            event.clientX - rect.left - el.clientLeft,
            event.clientY - rect.top - el.clientTop
        ];
    };



    /**
     * ２点間のカメラアニメーション
     *
     * 指定した位置間でカメラアニメーションを行う
     * iscs_startで指定した位置、もしくは現在のカメラの位置から、
     * iscs_endで指定した位置から20km南側、上方向に+20kmの高度の位置からiscs_endを注視点とした位置と方向に
     * timeで指定された秒数でカメラアニメーションを行う。
     * 途中、高度200kmまでカメラが上昇する
     *
     * @param  options 引数オブジェクト
     */
    async startFlyCamera( options: StandardUIViewer.FlyParam ) {
        const viewer = this._viewer;
        if ( !viewer || this._viewerCameraMode !== StandardUIViewer.CameraMode.CAMERA_FREE ) {
            return;
        }

        if ( !options.time || !options.iscs_end ) {
            return;
        }

        // animation
        // 経過時間の初期化
        this._flycamera_total_time = 0;
        this._flycamera_target_time = options.time; // km/s

        // create curve
        const curves = this.createFlyCurve(viewer, options);
        this._curve_move = curves.move;
        this._curve_rotation = curves.rotation;

        // EasyBindingBlock
        this._setupAnimationBindingBlock();

        // bind
        this._animation.bind("position", this._updater, this._curve_move);
        this._animation.bind("orientation", this._updater, this._curve_rotation);

        this._update_url_hash_backup = this._update_url_hash;   // URL更新フラグの待避
        this._update_url_hash = false;
        this._viewerCameraMode = StandardUIViewer.CameraMode.CAMERA_FLY;

        await new Promise<void>((onSuccess, onError) => {
            // onSuccess, onErrorは関数です。onSuccessを呼ぶまで、このプロミスは完了しません。
            this._flycamera_on_success = onSuccess; // onSuccessをグローバル変数に登録
        });
    }

    /**
     * KeyFrameでの位置や回転を算出
     *
     * @param   options 引数オブジェクト
     * @returns fly_param 算出した情報
     */
    private _calculateKeyPoint( viewer: mapray.Viewer, options: StandardUIViewer.FlyParam ): StandardUIViewer.FlyParamKeyPoint {
        /*
        *
        *    --- b -----------> c
        *     ^  ^              |
        *     |  |              v
        *     f  |              e ---
        *     |  |             /:  ^ 
        *     v  |            / :  | end_altitude
        *    --- a           /  :  v 
        *                   d   : ---
        *                   |<->|
        *                     end_from_lookat
        *
        * a: fly_iscs_start = options.iscs_start
        * b: start_top
        * c: end_top
        * d: options.iscs_end
        * e: fly_iscs_end
        * f: highest
        */

        const fly_iscs_start = new mapray.GeoPoint();
        if ( options.iscs_start ) {
            fly_iscs_start.assign( options.iscs_start );
        }
        else {
            const view_to_gocs = viewer.camera.view_to_gocs;
            fly_iscs_start.setFromGocs( GeoMath.createVector3([
                        view_to_gocs[12],
                        view_to_gocs[13],
                        view_to_gocs[14]
            ]));
        }

        const MAX_TOP_ALTITUDE = 1200000; // meter
        const end_from_lookat = options.end_from_lookat !== undefined ? options.end_from_lookat : 20000;
        const end_altitude = options.end_altitude !== undefined ? options.end_altitude : 20000;
        const target_clamp = options.target_clamp || true;

        // [アニメーションに利用する途中と最終の位置情報]
        // カメラの最終地点を計算
        const fly_iscs_end = this._getOffsetPoint( options.iscs_end.longitude, options.iscs_end.latitude, end_from_lookat, 0, new GeoPoint() );
        fly_iscs_end.altitude = viewer.getElevation( fly_iscs_end.latitude, fly_iscs_end.longitude ) + end_altitude;

        // カメラの注視点から最終アングル決定
        const cam_target = options.iscs_end;
        if ( target_clamp ) {
            cam_target.altitude = viewer.getElevation( cam_target.latitude, cam_target.longitude );
        }
        const target_angle = this._getLookAtAngle( fly_iscs_end, cam_target );

        // 途中点
        const from = new GeoPoint( fly_iscs_start.longitude, fly_iscs_start.latitude, 0 );
        const to = new GeoPoint( options.iscs_end.longitude, options.iscs_end.latitude, 0 );
        const highest = Math.min( from.getGeographicalDistance(to), MAX_TOP_ALTITUDE );

        const start_top = new GeoPoint();
        start_top.assign( fly_iscs_start );
        start_top.altitude += highest;

        const end_top = new GeoPoint();
        end_top.assign( fly_iscs_end );
        end_top.altitude += highest;

        this.setCameraParameter({near: 30, far:10000000});

        return {
            fly_iscs_start,
            fly_iscs_end,
            target_angle,
            start_top,
            end_top,
            heading: this._camera_parameter.yaw,
            tilt: this._camera_parameter.pitch,
            roll: 0,
        };
    }

    /**
     * curveの作成
     * this._curve_move と this._curve_rotation を作成 
     *
     * @param  viewer Viewer
     * @param  options 引数オブジェクト
     * @returns 移動用Curveと回転用curve
     */
    protected createFlyCurve( viewer: mapray.Viewer, options: StandardUIViewer.FlyParam ): { move: mapray.animation.KFLinearCurve, rotation: mapray.animation.KFLinearCurve } {
      // calculate key point
      const fly_param = this._calculateKeyPoint(viewer, options);

      let keyframes_m = [];
      let keyframes_r = [];

      let curve_move = new mapray.animation.KFLinearCurve(mapray.animation.Type.find("vector3"));
      let curve_rotation = new mapray.animation.KFLinearCurve(mapray.animation.Type.find("vector3"));

      const start = fly_param.fly_iscs_start;
      const end = fly_param.fly_iscs_end;
      const interval = this._flycamera_target_time/3.0;

      let up_flag = true;
      if (start.altitude > fly_param.start_top.altitude) {
          up_flag = false;
      }

      // @ts-ignore
      keyframes_m.push(mapray.animation.Time.fromNumber(0));
      keyframes_m.push(mapray.GeoMath.createVector3([start.longitude , start.latitude, start.altitude]));
      if ( up_flag ) {
        // @ts-ignore
        keyframes_m.push(mapray.animation.Time.fromNumber(interval));
        keyframes_m.push(mapray.GeoMath.createVector3([fly_param.start_top.longitude, fly_param.start_top.latitude, fly_param.start_top.altitude]));
        // @ts-ignore
        keyframes_m.push(mapray.animation.Time.fromNumber(interval*2));
        keyframes_m.push(mapray.GeoMath.createVector3([fly_param.end_top.longitude, fly_param.end_top.latitude, fly_param.end_top.altitude]));
      }
      // @ts-ignore
      keyframes_m.push(mapray.animation.Time.fromNumber(this._flycamera_target_time));
      keyframes_m.push(mapray.GeoMath.createVector3([end.longitude, end.latitude, end.altitude]));
      curve_move.setKeyFrames(keyframes_m);

      // @ts-ignore
      keyframes_r.push(mapray.animation.Time.fromNumber(0));
      keyframes_r.push(mapray.GeoMath.createVector3([fly_param.heading, fly_param.tilt, fly_param.roll]));
      if ( up_flag ) {
        // @ts-ignore
        keyframes_r.push(mapray.animation.Time.fromNumber(interval));
        keyframes_r.push(mapray.GeoMath.createVector3([fly_param.heading, 10, fly_param.roll]));
        // @ts-ignore
        keyframes_r.push(mapray.animation.Time.fromNumber(interval*2));
        keyframes_r.push(mapray.GeoMath.createVector3([fly_param.heading, 10, fly_param.roll]));
      }
      // @ts-ignore
      keyframes_r.push(mapray.animation.Time.fromNumber(this._flycamera_target_time));
      keyframes_r.push(mapray.GeoMath.createVector3([fly_param.target_angle.heading, fly_param.target_angle.tilt*-1, this._camera_parameter.roll]));
      curve_rotation.setKeyFrames(keyframes_r);

      return {move: curve_move, rotation: curve_rotation};
    }


    /**
     * update処理
     *
     * Fly実行中(this._viewerCameraMode が StandardUIViewer.CameraMode.CAMERA_FLY の時)は onUpdateFrame から呼び出されます
     */
    protected updateFlyCamera( delta_time: number ) {
      this._flycamera_total_time += delta_time;

      // @ts-ignore
      this._updater.update(mapray.animation.Time.fromNumber(this._flycamera_total_time));

      if (this._flycamera_total_time >= this._flycamera_target_time) {
          this.onEndFlyCamera();
      }

    }

    /**
     * fly完了処理
     *
     * Fly完了時に呼び出されます
     */
    protected onEndFlyCamera() {
      // unbind
      this._animation.unbind("position");
      this._animation.unbind("orientation");

      this._curve_move = undefined;
      this._curve_rotation = undefined;

      this._update_url_hash = this._update_url_hash_backup;       // URL更新フラグの復帰
      this._viewerCameraMode = StandardUIViewer.CameraMode.CAMERA_FREE;
      this._resetEventParameter();

      if (this._flycamera_on_success) {
          this._flycamera_on_success(); // ここで処理完了を通知する
          this._flycamera_on_success = undefined;
      }
    }

    /**
     * アニメーションの BindingBlock を初期化
     */
    private _setupAnimationBindingBlock()
    {
        const block = this._animation;  // 実体は EasyBindingBlock

        const vector3 = mapray.animation.Type.find( "vector3" );

        // パラメータ名: position
        // パラメータ型: vector3
        //   ベクトルの要素が longitude, latitude, altitude 順であると解釈
        block.addEntry( "position", [vector3], null, (value: mapray.Vector3) => {
            this.setCameraPosition(
              {longitude: value[0], latitude: value[1], height: value[2]}
            );
        } );

        // パラメータ名: view
        // パラメータ型: vector3
        //   型が matirix のときはビュー行列
        //   型が vector3 のとき、要素が heading, tilt, roll 順であると解釈
        block.addEntry( "orientation", [vector3], null, (value: mapray.Vector3) => {
            this._camera_parameter.yaw = value[0];
            this._camera_parameter.pitch = value[1];
            this.updateCamera();
        } );
    }

    /**
     * startからtargetを見るためののheadingとtiltを算出
     *
     * @param  start
     * @param  target
     */
    private _getLookAtAngle( start: mapray.GeoPoint, target: mapray.GeoPoint ): StandardUIViewer.HeadingTilt
    {
        // 現在の視線方向を取得
        const s_matrix = start.getMlocsToGocsMatrix( GeoMath.createMatrix() );
        let s_y_dir = GeoMath.createVector3([s_matrix[4], s_matrix[5], s_matrix[6]]);
        s_y_dir = GeoMath.normalize3( s_y_dir, GeoMath.createVector3() );

        const t_matrix = target.getMlocsToGocsMatrix( GeoMath.createMatrix() );
        let t_dir = GeoMath.createVector3([ t_matrix[12] - s_matrix[12], t_matrix[13] - s_matrix[13],　t_matrix[14] - s_matrix[14] ]);
        t_dir = GeoMath.normalize3( t_dir, GeoMath.createVector3() );

        const rotate_axis = GeoMath.createVector3([s_matrix[8], s_matrix[9], s_matrix[10]]);
        const heading_angle = this.calculateAngle( rotate_axis, s_y_dir, t_dir );
        const s_x_dir = GeoMath.createVector3([s_matrix[8], s_matrix[9], s_matrix[10]]);
        const rotate_axis2 = GeoMath.createVector3([s_matrix[0], s_matrix[1], s_matrix[2]]);

        t_dir[0] = -1 * t_dir[0];
        t_dir[1] = -1 * t_dir[1];
        t_dir[2] = -1 * t_dir[2];

        const tilt_angle = -1.0*GeoMath.clamp(
          Math.abs( this.calculateAngle( rotate_axis2, s_x_dir, t_dir ) ), 0, 90
        );

        return {
            heading: heading_angle,
            tilt: tilt_angle
        };
    }


    /**
     * ある地点から指定距離、指定方向に移動した位置を算出する
     *
     * @param longitude     経度
     * @param latitude      緯度
     * @param distance      距離(m)
     * @param bearing       方角(deg)
     * @param dst           計算結果が格納されるオブジェクト
     */
    private _getOffsetPoint( longitude: number, latitude: number, distance: number, bearing: number, dst: mapray.GeoPoint ): mapray.GeoPoint
    {
        const heading_theta = -(180 - bearing) * GeoMath.DEGREE;
        const vec_x = -distance * Math.sin( heading_theta );
        const vec_y =  distance * Math.cos( heading_theta );

        dst.setFromArray([longitude, latitude, 0]);
        const mat = dst.getMlocsToGocsMatrix( GeoMath.createMatrix() );

        dst.setFromGocs([
                vec_x * mat[0] + vec_y * mat[4] + mat[12],
                vec_x * mat[1] + vec_y * mat[5] + mat[13],
                vec_x * mat[2] + vec_y * mat[6] + mat[14]
        ]);

        return dst;
    }

    /**
     * 操作可否
     */
    protected getControllable(): boolean { return this._controllable; }

    /**
     * 操作可否を設定
     */
    protected setControllable( flag: boolean ) {
        if ( !this._controllable && flag ) {
            this._resetEventParameter();
            this._zoom_wheel = 0;
        }
        this._controllable = flag;
    }

}



interface CameraPositionOption {
    camera_position: mapray.GeoPointData;
    lookat_position: mapray.GeoPointData;
    yaw: number;
}



namespace StandardUIViewer {



export interface Option extends mapray.Viewer.Option {
     /** カメラ位置 */
     camera_position?: mapray.GeoPointData;

     /** 注視点位置 */
     lookat_position?: mapray.GeoPointData;

     /** カメラパラメータ */
     camera_parameter?: StandardUIViewer.CameraParameterOption;

     /** URL Hash更新 */
     url_update?: boolean;

     /** 大気層表示オプション */
     atmosphere?: mapray.Atmosphere;

     /** 太陽表示オプション */
     sun_visualizer?: mapray.SunVisualizer;

     /** 月表示オプション */
     moon_visualizer?: mapray.MoonVisualizer;
}



export interface FlyParam {
    /** 移動までにかかる時間（秒）。 */
    time: number;
    
    /** スタート位置. 省略時は現在のカメラ位置 */
    iscs_start?: mapray.GeoPoint;

    /** 終了位置でのカメラの注視点。 `target_clamp` が `true` の場合は高度を自動計算 */
    iscs_end: mapray.GeoPoint;

    /** 終了位置でカメラの注視点を `iscs_end` の緯度経度位置直下の標高にするなら `true` 省略時は `true` */
    target_clamp?: boolean;

    /** 最終カメラ位置の高さ(m) 省略時は20000m */
    end_altitude?: number;

    /** 最終カメラ位置を南方向に注視点からどの位置に配置するか(m) 省略時は20000m */
    end_from_lookat?: number;
}



export interface FlyParamKeyPoint {
    fly_iscs_start: mapray.GeoPoint;

    fly_iscs_end: mapray.GeoPoint;

    target_angle: HeadingTilt;

    start_top: mapray.GeoPoint;

    end_top: mapray.GeoPoint;

    heading: number;

    tilt: number;

    roll: number;
}



export interface HeadingTilt {
    heading: number;
    tilt: number;
}



export interface CameraParameter {
    /** 画角（度） */
    fov: number;

    /** 近接平面距離（m） */
    near: number;

    /** 遠方平面距離（m） */
    far: number;

    /** 移動速度係数 */
    speed_factor: number;
}


export interface CameraParameterOption {
    /** 画角（度） */
    fov?: number;

    /** 近接平面距離（m） */
    near?: number;

    /** 遠方平面距離（m） */
    far?: number;

    /** 移動速度係数 */
    speed_factor?: number;
}



export interface RollPitchYawData {
    roll: number;

    pitch: number;

    yaw: number;
}



export interface RollPitchYawOption {
    roll?: number;

    pitch?: number;

    yaw?: number;
}



export enum CameraMode {
    NONE,
    CAMERA_FREE,
    CAMERA_FLY,
}


export enum OperationMode {
    NONE,
    TRANSLATE,
    ROTATE,
    FREE_ROTATE,
    EYE_TRANSLATE,
    HEIGHT_TRANSLATE,
    CHANGE_FOVY,
}



// カメラ位置の初期値（本栖湖付近）
export const DEFAULT_CAMERA_POSITION = { latitude: 35.475968, longitude: 138.573161, height: 2000 };

// 注視点位置の初期値（富士山付近）
export const DEFAULT_LOOKAT_POSITION = { latitude: 35.360626, longitude: 138.727363, height: 2000 };

// カメラパラメータの初期値
export const DEFAULT_CAMERA_PARAMETER = { fov: 60, near: 30, far: 500000, speed_factor: 2000 };

// カメラと地表面までの最低距離
export const ALTITUDE_RANGE = { min: 2.0, max: undefined };

// 最小近接平面距離 (この値は ALTITUDE_RANGE.min * 0.5 より小さい値を指定します)
export const MINIMUM_NEAR = 1.0;

// 最小遠方平面距離
// export const MINIMUM_FAR = 500000;
export const MINIMUM_FAR = 2870162;

// 高度からの近接平面距離を計算するための係数
export const NEAR_FACTOR = 0.01;

// 近接平面距離からの遠方平面距離を計算するための係数
export const FAR_FACTOR = 10000;

// 画角の適用範囲
export const FOV_RANGE = { min: 5, max: 120 };

// 画角の倍率　θ' = 2 atan(tan(θ/2)*f)
export const FOV_FACTOR = 1.148698354997035;



} // namespace StandardUIViewer



export default StandardUIViewer;
