import { Vector3, Matrix } from "./GeoMath";
import GLEnv from "./GLEnv";
import FrameBuffer from "./FrameBuffer";
import Material, { AttributeBindInfoDict } from "./Material";
import Camera from "./Camera";
import GeoMath from "./GeoMath";

import depth_vs_code from "./shader/depth.vert";
import depth_fs_code from "./shader/depth.frag";


/**
 * マウスピック処理に関連する処理を行う
 * @internal
 */
class PickTool {

    private _glenv: GLEnv;

    /** width of pick canvas */
    private _width: number;

    /** height of pick canvas */
    private _height: number;

    private _camera: Camera;

    private _frame_buffer: FrameBuffer;

    private _depth_to_color_frame_buffer: FrameBuffer;

    private _depth_to_color_materials: Material[];

    private _indices_length: number;

    private _index_buf: WebGLBuffer;

    private _vertex_attribs: AttributeBindInfoDict;

    private _rid_value: Uint8Array;

    private _depth_value: Uint8Array;


    /**
     * @param glenv     WebGL 環境
     */
    constructor( glenv: GLEnv, option: PickTool.Option = {} ) {
        this._glenv = glenv;
        const gl = this._glenv.context;

        this._width  = option.width  || 11;
        this._height = option.height || 11;

        this._camera = new Camera({ width: this._width, height: this._height });

        this._frame_buffer = new FrameBuffer( this._glenv, this._width, this._height, {
                color_containers: [this._createColorContainer()],
                depth_container: this._createDepthContainer(),
        } as FrameBuffer.Option );

        this._depth_to_color_frame_buffer = new FrameBuffer( this._glenv, this._width, this._height, {
                color_containers: [this._createColorContainer()],
        });

        this._depth_to_color_materials = [
            new Material( this._glenv, depth_vs_code, define_PASS_BASE_0 + "\n\n" + depth_fs_code ),
            new Material( this._glenv, depth_vs_code, define_PASS_BASE_1 + "\n\n" + depth_fs_code ),
        ];

        {
            const vertex_buf = gl.createBuffer();
            if ( !vertex_buf ) {
                throw new Error("couldn't create buffer");
            }
            {
                const vertices = [ -1.0, 1.0,  -1.0, -1.0,  1.0, -1.0,  1.0, +1.0 ];
                gl.bindBuffer(gl.ARRAY_BUFFER, vertex_buf);
                gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
                gl.bindBuffer(gl.ARRAY_BUFFER, null);
            }

            const texcoord_buf = gl.createBuffer();
            if ( !texcoord_buf ) {
                throw new Error("couldn't create buffer");
            }
            {
                const texcoord = [ 0, 1,  0, 0,  1, 0,  1, 1 ];
                gl.bindBuffer(gl.ARRAY_BUFFER, texcoord_buf);
                gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(texcoord), gl.STATIC_DRAW);
                gl.bindBuffer(gl.ARRAY_BUFFER, null);
            }

            {
                const indices = [ 0, 1, 2,  0, 2, 3 ];
                this._indices_length = indices.length;
                const buffer = gl.createBuffer();
                if ( !buffer ) {
                    throw new Error("couldn't create buffer");
                }
                this._index_buf = buffer;
                gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._index_buf);
                gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
                gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
            }

            this._vertex_attribs = {
                "a_position": {
                    buffer:         vertex_buf,
                    num_components: 2,
                    component_type: gl.FLOAT,
                    normalized:     false,
                    byte_stride:    0,
                    byte_offset:    0
                },
                "a_texcoord": {
                    buffer:         texcoord_buf,
                    num_components: 2,
                    component_type: gl.FLOAT,
                    normalized:     false,
                    byte_stride:    0,
                    byte_offset:    0
                }
            };
        }

        this._rid_value   = new Uint8Array( 4 * this._width * this._height );
        this._depth_value = new Uint8Array( 4 * this._width * this._height );
    }


    /**
     * カラーコンテナを作成します
     */
    private _createColorContainer() /* auto-type */
    {
        const gl = this._glenv.context;
        return {
            type: FrameBuffer.ContainerType.RENDER_BUFFER,
            option: {
                internal_format: gl.RGBA4,
                format: gl.RGBA4,
                type: gl.UNSIGNED_BYTE,
            },
        };
    }


    /**
     * 深度コンテナを作成します
     */
    private _createDepthContainer() /* auto-type */
    {
        const glenv = this._glenv;
        const gl  = glenv.context;
        const gl2 = glenv.context2;
        if ( gl2 ) {
            return {
                type: FrameBuffer.ContainerType.TEXTURE,
                attach_type: gl2.DEPTH_ATTACHMENT,
                option: {
                    internal_format: gl2.DEPTH_COMPONENT24,
                    format: gl2.DEPTH_COMPONENT,
                    type: gl2.UNSIGNED_INT,
                },
            };
        }
        else {
            if ( !glenv.WEBGL_depth_texture ) {
                throw new Error("Depth Texture not supported");
            }
            return {
                type: FrameBuffer.ContainerType.TEXTURE,
                attach_type: gl.DEPTH_STENCIL_ATTACHMENT,
                option: {
                    internal_format: gl.DEPTH_STENCIL,
                    format: gl.DEPTH_STENCIL,
                    type: glenv.WEBGL_depth_texture.UNSIGNED_INT_24_8_WEBGL,
                },
            };
        }
    }


    /**
     * ピック用カメラを返却する。同じインスタンスが返却される。
     * @param viewer_camera Viewreのカメラ
     */
    pickCamera( viewer_camera: Camera ): Camera
    {
        const cw = viewer_camera.canvas_size.width;
        const ch = viewer_camera.canvas_size.height;
        this._camera.copyViewParameters( viewer_camera );
        const hfov_rad = viewer_camera.fov * GeoMath.DEGREE / 2;
        const cw2 = this._camera.canvas_size.width;
        const ch2 = this._camera.canvas_size.height;
        const hfov_rad2 = Math.atan( Math.sqrt( cw2*cw2 + ch2*ch2 ) * Math.tan( hfov_rad ) / Math.sqrt( cw*cw + ch*ch ) );
        this._camera.fov  = 2 * hfov_rad2 / GeoMath.DEGREE;
        return this._camera;
    }


    /**
     * Scene描画処理直前に呼ばれる
     */
    beforeRender(): void
    {
        this._frame_buffer.bind();
    }


    /**
     * Scene描画処理直後に呼ばれる
     */
    afterRender(): void
    {
        this._frame_buffer.unbind();
    }


    /**
     * Scene描画処理がキャンセルされたときに呼ばれる
     */
    renderCanceled(): void
    {
        this._frame_buffer.unbind();
    }


    /**
     * ridを、描画済みテクスチャから読む（1ステップ前の値が返却される）
     */
    readRid(): number
    {
        const gl = this._glenv.context;
        const startRid = Date.now();
        this._frame_buffer.bind();

        let startRidRead, endRidRead;

        startRidRead = Date.now();

        gl.readPixels( 0, 0, this._width, this._height, gl.RGBA, gl.UNSIGNED_BYTE, this._rid_value );
        endRidRead = Date.now();
        // 4bit x4 の値が 8bit x4 に格納されている。
        /*
        const rid = Math.round(
            this._rid_value[0] / 17 << 12 |
            this._rid_value[1] / 17 <<  8 |
            this._rid_value[2] / 17 <<  4 |
            this._rid_value[3] / 17
        );
        */
        const offset = 4 * Math.floor( this._width * this._height / 2 );
        const rid = Math.round(
            COEFFICIENTS_RID[ 0 ] * Math.round(this._rid_value[ offset + 0 ] / 17.0) +
            COEFFICIENTS_RID[ 1 ] * Math.round(this._rid_value[ offset + 1 ] / 17.0) +
            COEFFICIENTS_RID[ 2 ] * Math.round(this._rid_value[ offset + 2 ] / 17.0) +
            COEFFICIENTS_RID[ 3 ] * Math.round(this._rid_value[ offset + 3 ] / 17.0)
        );

        this._frame_buffer.unbind();

        const endRid = Date.now();
        DEBUG: {
            if ( endRid - startRid > 7 ) {
                console.log("Render and Read Index: " + (endRid - startRid) + "ms gl.readPixels:" + (endRidRead - startRidRead) + "ms");
            }
        }

        return rid;
    }


    /**
     * 深度値を、描画済みテクスチャから読み（1ステップ前の値が返却される）、Gocs座標系に変換する
     * @param view_to_clip View座標系からクリップ座標系への変換マトリックス
     * @param view_to_gocs View座標系からView座標系への変換マトリックス
     */
    readDepth( view_to_clip: Matrix, view_to_gocs: Matrix ): Vector3
    {
        const gl = this._glenv.context;

        const startDepth = Date.now();
        let startDepthRead = -1, endDepthRead = -1;

        this._depth_to_color_frame_buffer.bind();

        let depth_clip = 0;
        gl.viewport( 0, 0, this._width, this._height );
        for ( let i=0; i<2; i++ ) {
            const depth_buffer = this._frame_buffer.depth_container as WebGLTexture | WebGLRenderbuffer;
            const material = this._depth_to_color_materials[ i ];
            material.bindProgram();
            material.bindVertexAttribs(this._vertex_attribs);
            material.setInteger( "u_sampler", 0 );
            material.bindTexture2D( 0, depth_buffer );
            gl.depthFunc( gl.ALWAYS );
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._index_buf);
            gl.drawElements(gl.TRIANGLES, this._indices_length, gl.UNSIGNED_SHORT, 0);
            gl.bindTexture(gl.TEXTURE_2D, null);

            startDepthRead = Date.now();
            gl.readPixels( 0, 0, this._width, this._height, gl.RGBA, gl.UNSIGNED_BYTE, this._depth_value );
            endDepthRead = Date.now();

            // 4bit x4 の値が 8bit x4 に格納されている。 => [0.0 〜 1.0]
            /*
            depth_clip += (
                this._depth_value[ 0 ] * Math.pow(2, i==0 ? -3  : -15) / 17.0 +
                this._depth_value[ 1 ] * Math.pow(2, i==0 ? -6  : -18) / 17.0 +
                this._depth_value[ 2 ] * Math.pow(2, i==0 ? -9  : -21) / 17.0 +
                this._depth_value[ 3 ] * Math.pow(2, i==0 ? -12 : -24) / 17.0
            );
            */
            const coef = COEFFICIENTS_DEPTH[ i ];
            for ( let j=0; j<4; j++ ) {
                depth_clip += coef[ j ] * this._depth_value[ j ];
            }
        }
        this._depth_to_color_frame_buffer.unbind();

        depth_clip = 2.0 * depth_clip - 1.0; // [0.0 〜 1.0] => [-1.0 〜 1.0]

        const vtc = view_to_clip;

        /*
        const ctv = GeoMath.inverse(vtc, GeoMath.createMatrix());
        const v = GeoMath.mul( ctv, [ 0, 0, c ] );
        */
        const v = [
            vtc[8] / vtc[0],
            vtc[9] / vtc[5],
            -1.0,
            (depth_clip + vtc[10]) / vtc[14]
        ];

        // const point = GeoMath.mul_Av( view_to_gocs, v );
        const m = view_to_gocs;
        const w = m[3]*v[0] + m[7]*v[1] + m[11]*v[2] + m[15]*v[3];
        const point = GeoMath.createVector3([
                ( m[0]*v[0] + m[4]*v[1] + m[ 8]*v[2] + m[12]*v[3] ) / w,
                ( m[1]*v[0] + m[5]*v[1] + m[ 9]*v[2] + m[13]*v[3] ) / w,
                ( m[2]*v[0] + m[6]*v[1] + m[10]*v[2] + m[14]*v[3] ) / w
        ]);

        const endDepth = Date.now();
        DEBUG: {
            if ( endDepth - startDepth > 7 ) {
                console.log("Render and Read Depth: " + (endDepth - startDepth) + "ms gl.readPixels:" + (endDepthRead - startDepthRead) + "ms");
            }
        }

        return point;
    }
}



namespace PickTool {



export interface Option {
    width?: number;
    height?: number;
}



} // PickTool



const COEFFICIENTS_RID: number[] = [];
for ( let i=0; i<4; i++ ) {
    COEFFICIENTS_RID[ i ] = Math.pow(16, 3 - i);
}

const COEFFICIENTS_DEPTH: number[][] = [[],[]];
for ( let i=0; i<4; i++ ) {
    COEFFICIENTS_DEPTH[ 0 ][ i ] = Math.pow(2, -3 * (i+1)) / 17.0;
    COEFFICIENTS_DEPTH[ 1 ][ i ] = Math.pow(2, -3 * (i+5)) / 17.0;
}


const define_PASS_BASE_0 = "#define PASS_BASE 0";
const define_PASS_BASE_1 = "#define PASS_BASE 1";


export default PickTool;
